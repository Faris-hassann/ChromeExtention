import { describe, expect, it, vi } from 'vitest';
import { AgentOrchestrator } from './orchestrator.js';
import { observe, result } from './test-events.js';
import type { AgentDecision, BrowserObservation } from '../types.js';
const page=(taskId:string):BrowserObservation=>({taskId,observationId:crypto.randomUUID(),tabId:'1',url:'https://example.com/',timestamp:'',title:'Example',loadingState:'complete',interactiveElements:[{elementId:'el_button',name:'Button',role:'button'}]});
describe('structured interruption reasons',()=>{
  it.each([['pause','USER_PAUSE','PAUSED'],['stop','USER_STOP','CANCELLED'],['take_control','TAKE_CONTROL','PAUSED'],['deny','APPROVAL_DENIED','PAUSED']] as const)('emits and retains a reason for %s', (action,code,state)=>{
    const events:any[]=[];const agent=new AgentOrchestrator({decide:vi.fn()},undefined,event=>events.push(event));const task=agent.create('A browser task');agent.control(task.id,action);
    expect(task.reason?.code).toBe(code);expect(agent.metrics(task)).toMatchObject({state,reason:{code},requestCount:0});
    expect(events.at(-1)).toMatchObject({event:'server.task_state',payload:{state,reason:{code}}});
    if(state==='PAUSED'){agent.control(task.id,'resume');expect(task.reason).toBeUndefined();}
    else {agent.control(task.id,'resume');expect(task.reason?.code).toBe(code);}
  });
  it('retains disconnect and user-input explanations',async()=>{
    const agent=new AgentOrchestrator({decide:vi.fn().mockResolvedValue({type:'user_input_required',question:'Which table should I use?'})});const task=agent.create('Choose a table');await observe(agent,task.id,page(task.id));
    expect(task.reason).toMatchObject({code:'INPUT_REQUIRED',message:'Which table should I use?'});
    agent.control(task.id,'resume');agent.disconnect();expect(task.reason?.code).toBe('DISCONNECTED');
  });
  it('retains completion and error reasons without resetting metrics or restarting',async()=>{
    const completed=new AgentOrchestrator({decide:vi.fn().mockResolvedValue({type:'complete_request',summary:'Verified.'})});const done=completed.create('Observe this page');await observe(completed,done.id,page(done.id));
    expect(completed.metrics(done)).toMatchObject({state:'COMPLETED',reason:{code:'GOAL_VERIFIED',message:'Verified.'}});completed.control(done.id,'resume');expect(done.state).toBe('COMPLETED');
    const failed=new AgentOrchestrator({decide:vi.fn().mockRejectedValue(new Error('The model request failed.'))});const error=failed.create('Observe this page');await observe(failed,error.id,page(error.id));
    expect(failed.metrics(error)).toMatchObject({state:'FAILED',reason:{code:'EXECUTION_ERROR',message:'The model request failed.'}});
  });
  it('attaches approval and no-progress reasons without replaying actions',async()=>{
    const decision:AgentDecision={type:'tool_request',tool:'click',arguments:{elementId:'el_button'}};
    const approval=new AgentOrchestrator({decide:vi.fn().mockResolvedValue(decision)});const waiting=approval.create('Click the button','manual');await observe(approval,waiting.id,page(waiting.id));expect(waiting.reason?.code).toBe('APPROVAL_REQUIRED');
    const repeated=new AgentOrchestrator({decide:vi.fn().mockResolvedValue(decision)});const task=repeated.create('Click the button','always');
    for(let i=0;i<3;i++){await observe(repeated,task.id,page(task.id));result(repeated,task.id,{ok:true});}
    await observe(repeated,task.id,page(task.id));expect(task.reason?.code).toBe('NO_PROGRESS');expect(task.pending).toBeUndefined();
  });
});
