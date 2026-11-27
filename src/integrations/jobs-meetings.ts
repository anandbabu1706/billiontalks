import { MeetingAccessMode, MeetingService, MeetingStatus } from "../meeting";
import type { InterviewMeetingActivation, MeetingsAdapterV1 } from "../jobs/contracts";

function opaqueMeetingId(ref: string): string {
  const normalized=ref.replace(/[^A-Za-z0-9_-]/g,'').slice(0,48);
  if(!normalized)throw new Error('Interview reference is invalid.');
  return `btm_job_${normalized}`;
}

/** The only component allowed to translate Jobs interview references into Meetings operations. */
export class JobsMeetingsAdapter implements MeetingsAdapterV1 {
  readonly version="billiontalks-meetings.v1" as const;
  constructor(private readonly meetings:MeetingService){}
  async activate(input:InterviewMeetingActivation){
    const meetingId=opaqueMeetingId(input.interviewRef);
    const meeting=await this.meetings.createMeeting({meetingId,title:input.title,hostUserId:input.hostSubject,accessMode:MeetingAccessMode.HOST_APPROVAL,integration:{version:'jobs-interview.v1',ref:input.interviewRef,authorizedUserIds:input.participantSubjects}});
    if(meeting.status!==MeetingStatus.ACTIVE)throw new Error('Interview meeting is not active.');
    return {meetingRef:meeting.id,joinPath:`/jobs/interviews/${encodeURIComponent(input.interviewRef)}`};
  }
  async authorizeJoin(meetingRef:string,interviewRef:string,subject:string,displayName:string){
    await this.meetings.joinIntegratedMeeting(meetingRef,interviewRef,{userId:subject,displayName});
    return {joinPath:`/ui?meeting=${encodeURIComponent(meetingRef)}`};
  }
  async revoke(meetingRef:string,interviewRef:string,hostSubject:string){
    const meeting=await this.meetings.getMeeting(meetingRef);
    if(!meeting||meeting.integration?.ref!==interviewRef)throw new Error('Interview meeting reference mismatch.');
    if(meeting.status===MeetingStatus.ACTIVE)await this.meetings.endMeeting(meetingRef,hostSubject);
  }
}
