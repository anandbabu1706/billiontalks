import { JobsError, type Identity, type JobsDatabase } from './contracts';
import { JobsGovernance } from './governance';

/** Local durable in-app reminder dispatch. Invocation scheduling remains a pre-pilot gate. */
export class JobsOperations {
  constructor(private readonly db:JobsDatabase,private readonly clock:()=>number=Date.now){}
  async queueReminders(actor:Identity){await new JobsGovernance(this.db,this.clock).authorize(actor,'INCIDENT',true);const now=this.clock();
    const rows=(await this.db.prepare(`SELECT i.id,i.revision,a.candidate,s.starts_at FROM interviews i
      JOIN applications a ON a.id=i.application JOIN interview_slots s ON s.id=i.confirmed_slot
      WHERE i.state='CONFIRMED' AND s.starts_at>? AND s.starts_at<=? AND (
        NOT EXISTS(SELECT 1 FROM interview_reminder_outbox q WHERE q.interview=i.id AND q.interview_revision=i.revision AND q.window='24H')
        OR (s.starts_at<=? AND NOT EXISTS(SELECT 1 FROM interview_reminder_outbox q WHERE q.interview=i.id AND q.interview_revision=i.revision AND q.window='1H')))
      ORDER BY s.starts_at,i.id LIMIT 100`)
      .bind(new Date(now).toISOString(),new Date(now+24*3600_000).toISOString(),new Date(now+3600_000).toISOString()).all<{id:string;revision:number;candidate:string;starts_at:string}>()).results;
    let queued=0;for(const row of rows){const start=Date.parse(row.starts_at);for(const [window,threshold] of [['24H',24*3600_000],['1H',3600_000]] as const){
      if(now<start-threshold||now>=start)continue;
      const result=await this.db.prepare("INSERT OR IGNORE INTO interview_reminder_outbox VALUES(?,?,?,?,?,?,'PENDING',0,?,?,?) RETURNING id")
        .bind(crypto.randomUUID(),row.id,row.revision,window,row.candidate,row.starts_at,now,now,now).first();if(result)queued++;
    }}return {queued};
  }
  async dispatchReminders(actor:Identity,limit=10){await new JobsGovernance(this.db,this.clock).authorize(actor,'INCIDENT',true);
    if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new JobsError(400,'invalid_limit');const now=this.clock();
    const rows=(await this.db.prepare("SELECT id,interview,interview_revision,window,candidate,starts_at,attempts FROM interview_reminder_outbox WHERE status IN ('PENDING','FAILED') AND attempts<5 AND next_attempt_at<=? ORDER BY created_at,id LIMIT ?")
      .bind(now,limit).all<{id:string;interview:string;interview_revision:number;window:string;candidate:string;starts_at:string;attempts:number}>()).results;
    let delivered=0,stale=0,failed=0;
    for(const row of rows){
      const current=await this.db.prepare("SELECT revision,state FROM interviews WHERE id=?").bind(row.interview).first<{revision:number;state:string}>();
      if(!current||current.state!=='CONFIRMED'||current.revision!==row.interview_revision||Date.parse(row.starts_at)<=now){
        await this.db.prepare("UPDATE interview_reminder_outbox SET status='COMPLETED',updated_at=? WHERE id=?").bind(now,row.id).run();stale++;continue;
      }
      try{const batch=await this.db.batch([
        this.db.prepare("INSERT OR IGNORE INTO jobs_notifications(id,candidate,application,event_key,kind,data,at) SELECT ?,a.candidate,a.id,?,'INTERVIEW_REMINDER',?,? FROM interviews i JOIN applications a ON a.id=i.application WHERE i.id=? AND i.revision=? AND i.state='CONFIRMED' AND EXISTS(SELECT 1 FROM interview_reminder_outbox WHERE id=? AND status IN ('PENDING','FAILED') AND attempts=?)")
          .bind(crypto.randomUUID(),`interview-reminder:${row.interview}:${row.interview_revision}:${row.window}`,JSON.stringify({interview:row.interview,startsAt:row.starts_at,window:row.window}),now,row.interview,row.interview_revision,row.id,row.attempts),
        this.db.prepare("UPDATE interview_reminder_outbox SET status='COMPLETED',attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('PENDING','FAILED') AND attempts=?").bind(now,row.id,row.attempts)
      ]);
        const inserted=batch[0] as {meta:{changes:number}};
        if(inserted.meta.changes>0)delivered++;
}catch{const next=row.attempts+1;await this.db.prepare("UPDATE interview_reminder_outbox SET status='FAILED',attempts=?,next_attempt_at=?,updated_at=? WHERE id=? AND status IN ('PENDING','FAILED') AND attempts=?").bind(next,now+Math.min(300_000,1000*2**next),now,row.id,row.attempts).run();failed++;}
    }return {delivered,stale,failed};
  }
}
