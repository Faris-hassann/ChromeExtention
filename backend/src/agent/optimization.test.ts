import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentOrchestrator } from './orchestrator.js';
import { observe, result } from './test-events.js';
import { processWorkflow, nextProcess, verifyObjective } from './executor.js';
import { decisionContext, ContextBudgetError, parseToolDecision } from '../llm/context.js';
import { planningTools, parsePlan } from '../llm/planning.js';
import { config } from '../config.js';
import { MetricsStore, requestTracker } from '../llm/metrics.js';
import type { AgentDecision, BrowserObservation, SemanticElement } from '../types.js';

const identifier='825444_Care_UK_CBUPorting';
const field: SemanticElement={elementId:'el_old',role:'textbox',name:'Name',value:'',widget:'Profile',documentId:'doc',frameId:'0'};
const cell: SemanticElement={elementId:'el_cell',role:'gridcell',name:identifier,text:identifier,columnName:'Process Name',tableName:'Processes',rowText:identifier+' MAY',rowIndex:1,documentId:'doc',frameId:'0'};
const page=(taskId:string,elements:SemanticElement[]=[field],extra:Partial<BrowserObservation>={}):BrowserObservation=>({observationId:crypto.randomUUID(),taskId,tabId:'1',timestamp:'',url:'https://example.com/',title:'Example',loadingState:'complete',interactiveElements:elements,...extra});
const modelPlan: AgentDecision={type:'execution_plan',actions:[{tool:'focus',arguments:{elementId:field.elementId},target:field},{tool:'fill',arguments:{elementId:field.elementId,value:'Alice'},target:field}],verification:{kind:'field_value',value:'Alice',target:field}};
const originalConfig={...config};
afterEach(()=>{Object.assign(config,originalConfig);vi.unstubAllGlobals();});
function setup(goal='Please enter Alice in Name',decision:AgentDecision=modelPlan){const decide=vi.fn().mockResolvedValue(decision);const events:any[]=[];const agent=new AgentOrchestrator({decide},undefined,event=>events.push(event));return {agent,task:agent.create(goal,'always'),events,decide};}

describe('compact planning and local execution',()=>{
  it('runs a two-action plan with fresh refs and no completion request',async()=>{
    const {agent,task,decide}=setup();await observe(agent,task.id,page(task.id));expect(task.pending?.tool).toBe('focus');result(agent,task.id,{ok:true});
    await observe(agent,task.id,page(task.id,[{...field,elementId:'el_new'}]));expect(task.pending).toMatchObject({tool:'fill',arguments:{elementId:'el_new',value:'Alice'}});result(agent,task.id,{ok:true});
    await observe(agent,task.id,page(task.id,[{...field,elementId:'el_final',value:'Alice'}]));expect(task.state).toBe('COMPLETED');expect(decide).toHaveBeenCalledTimes(1);expect(task.execution).toBeUndefined();expect(task.observation).toBeUndefined();
    expect(task.metrics.snapshot().execution).toEqual({model:2,local:0,recovery:0});
  });
  it('recovers a confirmed stale target once with no extra model request',async()=>{
    const {agent,task,decide}=setup();await observe(agent,task.id,page(task.id));result(agent,task.id,{ok:false,code:'STALE_ELEMENT'});
    await observe(agent,task.id,page(task.id,[{...field,elementId:'el_fresh'}]));expect(task.pending?.arguments.elementId).toBe('el_fresh');expect(decide).toHaveBeenCalledTimes(1);result(agent,task.id,{ok:true});
    await observe(agent,task.id,page(task.id,[{...field,elementId:'el_fresher'}]));expect(task.pending?.tool).toBe('fill');result(agent,task.id,{ok:true});await observe(agent,task.id,page(task.id,[{...field,elementId:'el_done',value:'Alice'}]));
    expect(task.state).toBe('COMPLETED');expect(decide).toHaveBeenCalledTimes(1);expect(task.metrics.snapshot().execution.recovery).toBe(1);
  });
  it.each(['INPUT_MISMATCH','UNKNOWN_RESULT'])('does not retry failure %s locally',async code=>{
    const {agent,task,decide}=setup();await observe(agent,task.id,page(task.id));result(agent,task.id,{ok:false,code});
    decide.mockResolvedValue({type:'user_input_required',question:'Check the field.'});await observe(agent,task.id,page(task.id));expect(decide).toHaveBeenCalledTimes(2);expect(task.state).toBe('PAUSED');expect(task.execution).toBeUndefined();
  });
  it('replans after a second stale failure or an ambiguous target',async()=>{
    const {agent,task,decide}=setup();await observe(agent,task.id,page(task.id));result(agent,task.id,{ok:false,code:'STALE_ELEMENT'});await observe(agent,task.id,page(task.id,[{...field,elementId:'el_retry'}]));result(agent,task.id,{ok:false,code:'STALE_ELEMENT'});
    decide.mockResolvedValue({type:'user_input_required',question:'Target moved.'});await observe(agent,task.id,page(task.id,[field,{...field,elementId:'el_duplicate'}]));expect(decide).toHaveBeenCalledTimes(2);expect(task.state).toBe('PAUSED');
  });
  it.each(['pause','stop','disconnect'] as const)('drops remaining planned actions after %s',async control=>{
    const {agent,task,decide,events}=setup();await observe(agent,task.id,page(task.id));const oldId=task.pending!.toolCallId;if(control==='disconnect')agent.disconnect();else agent.control(task.id,control);agent.actionResult(task.id,{ok:true},oldId);
    expect(task.execution).toBeUndefined();expect(events.filter(event=>event.event==='server.action_request'&&event.payload.tool!=='observe_page')).toHaveLength(1);
    if(control!=='stop'){decide.mockResolvedValue({type:'user_input_required',question:'Revalidate.'});agent.control(task.id,'resume');await observe(agent,task.id,page(task.id));expect(decide).toHaveBeenCalledTimes(2);}
  });
  it('applies existing approval checks to every action',async()=>{
    const {agent,task}=setup();task.approvalMode='manual';await observe(agent,task.id,page(task.id));expect(task.state).toBe('WAITING_FOR_APPROVAL');agent.control(task.id,'approve');expect(task.pending?.tool).toBe('focus');result(agent,task.id,{ok:true});await observe(agent,task.id,page(task.id));expect(task.state).toBe('WAITING_FOR_APPROVAL');expect(task.pendingApproval?.tool).toBe('fill');
  });
  it('finishes an explicit navigation and labelled-field update with zero model calls',async()=>{
    const first=setup('Open https://destination.test/');await observe(first.agent,first.task.id,page(first.task.id));result(first.agent,first.task.id,{ok:true});await observe(first.agent,first.task.id,page(first.task.id,[],{url:'https://destination.test/'}));expect(first.task.state).toBe('COMPLETED');expect(first.decide).not.toHaveBeenCalled();
    const second=setup('Fill Name with "Alice"');await observe(second.agent,second.task.id,page(second.task.id));result(second.agent,second.task.id,{ok:true});await observe(second.agent,second.task.id,page(second.task.id,[{...field,value:'Alice'}]));expect(second.task.state).toBe('COMPLETED');expect(second.decide).not.toHaveBeenCalled();
  });
  it('verifies an explicit Google search locally and does not send another model request',async()=>{
    const {agent,task,decide}=setup('Search for "porting"');const search={...field,name:'Search',role:'searchbox'};await observe(agent,task.id,page(task.id,[search],{url:'https://www.google.com/'}));result(agent,task.id,{ok:true});await observe(agent,task.id,page(task.id,[{...search,elementId:'el_search2',value:'porting'}],{url:'https://www.google.com/'}));expect(task.pending?.tool).toBe('press_key');result(agent,task.id,{ok:true});await observe(agent,task.id,page(task.id,[search],{url:'https://www.google.com/search?q=porting',searchResultsVisible:true}));expect(task.state).toBe('COMPLETED');expect(decide).not.toHaveBeenCalled();
  });
  it('ranks goal matches and sends aliases instead of internal IDs',()=>{
    const elements: SemanticElement[]=Array.from({length:100},(_,i)=>({...field,elementId:'el_transport_long_'+i,name:'Navigation '+i,text:'irrelevant '.repeat(60)}));elements.push({...cell,elementId:'el_private_document_token'});
    const context=decisionContext(identifier+' filter inside the dashboard using this',page('t',elements),{});const prompt=context.messages[1]!.content;expect(prompt).toContain(identifier);expect(prompt).not.toContain('el_transport');expect(prompt).not.toContain('el_private');expect(Object.keys(context.bindings).length).toBeLessThanOrEqual(25);expect(context.estimatedInputTokens).toBeLessThanOrEqual(1500);expect(context.tools.map(tool=>tool.function.name)).toEqual(['execute_plan','complete_task','request_user_input']);
  });
  it('expands required context and never truncates essential user instructions',()=>{
    config.contextTargetTokens=700;config.contextMaxTokens=3000;const goal=Array.from({length:350},(_,i)=>'instruction'+i).join(' ');const context=decisionContext(goal,page('t',[]),{});expect(context.expanded).toBe(true);expect(context.messages[1]!.content).toContain(goal);config.contextMaxTokens=700;expect(()=>decisionContext(goal,page('t',[]),{})).toThrow(ContextBudgetError);
  });
  it('validates complete plans and rejects unsafe or unknown action arguments',()=>{
    const refs={e1:field};const allowed=['fill','focus'] as const;
    expect(parsePlan({actions:[{tool:'fill',ref:'e1',arguments:{value:'Alice'}}],verification:{kind:'field_value',ref:'e1',value:'Alice'}},refs,[...allowed])).toMatchObject({type:'execution_plan',actions:[{arguments:{elementId:'el_old'}}]});
    for(const action of [{tool:'fill',ref:'unknown',arguments:{value:'Alice'}},{tool:'fill',ref:'e1',arguments:{selector:'#Name',value:'Alice'}},{tool:'fill',ref:'e1',arguments:{elementId:'el_other',value:'Alice'}},{tool:'evaluate',arguments:{script:'alert()'}}])expect(()=>parsePlan({actions:[action],verification:{kind:'observe'}},refs,[...allowed])).toThrow();
    expect(()=>parsePlan({actions:Array.from({length:7},()=>({tool:'focus',ref:'e1'})),verification:{kind:'observe'}},refs,[...allowed])).toThrow();
    expect(()=>parseToolDecision({message:{tool_calls:[{function:{name:'execute_plan',arguments:{actions:[{tool:'focus',ref:'e1'}],verification:{kind:'invented'}}}}]}},planningTools(),refs,[...allowed])).toThrow();
  });
  it('emits advisory warnings once and keeps accounting without pausing',()=>{
    const metrics=new MetricsStore('t',{input:2,cached:0,output:8});for(let i=0;i<3;i++){const request=requestTracker('mini','t',record=>metrics.accept(record),{input:2,cached:0,output:8});request.planning(900,2);request.capture({usage:{prompt_tokens:900,completion_tokens:50,total_tokens:950,prompt_tokens_details:{cached_tokens:0}}});request.finish('succeeded');}
    expect(metrics.snapshot().warnings).toHaveLength(3);expect(metrics.snapshot().requestCount).toBe(3);expect(metrics.snapshot().estimatedInputTokens).toBe(2700);
  });
});

describe('adaptive process filtering',()=>{
  const powerPage=(id:string,elements:SemanticElement[]=[cell],extra:Partial<BrowserObservation>={})=>page(id,elements,{url:'https://app.powerbi.com/groups/w/reports/r',dashboardEvidence:{filters:[],visuals:[{key:'Related dashboard',text:'All processes'}]},...extra});
  it('benchmarks the supplied example with zero calls, including one stale-target recovery',async()=>{
    const {agent,task,decide}=setup(identifier+' filter inside the dashboard using this');await observe(agent,task.id,powerPage(task.id));expect(task.pending?.tool).toBe('find_element');result(agent,task.id,{ok:true,matchCount:7});await observe(agent,task.id,powerPage(task.id,[{...cell,searchMatch:true}]));result(agent,task.id,{ok:false,code:'STALE_ELEMENT'});await observe(agent,task.id,powerPage(task.id,[{...cell,elementId:'el_current',searchMatch:true}]));expect(task.pending?.arguments.elementId).toBe('el_current');result(agent,task.id,{ok:true});await observe(agent,task.id,powerPage(task.id,[{...cell,elementId:'el_after',selected:true}],{dashboardEvidence:{filters:[],visuals:[{key:'Related dashboard',text:identifier+' 12 requests'}]}}));expect(task.state).toBe('COMPLETED');expect(task.workflow).toBeUndefined();expect(decide).not.toHaveBeenCalled();expect(task.metrics.snapshot()).toMatchObject({requestCount:0,execution:{local:2,recovery:1}});
  });
  it('does not claim filtering from selected-row state alone or changes in the clicked table',()=>{
    const before=powerPage('t');const after=powerPage('t',[{...cell,selected:true}],{dashboardEvidence:{filters:[],visuals:[{key:'Processes',text:identifier+' changed',processTable:true}]}});const memory={tableInteraction:{clicked:{text:identifier,observationId:before.observationId}}};expect(verifyObjective({kind:'dashboard_filter',value:identifier},before,after,'filter '+identifier,memory)).toBeUndefined();expect(verifyObjective({kind:'table_selection',value:identifier},before,after,'select '+identifier,memory)).toContain('Selected');
  });
  it('runs a scoped filter through a hidden search field and Apply',async()=>{
    const {agent,task,decide}=setup('Filter '+identifier);const widget='Process Name filter';const open={elementId:'el_open',role:'button',name:'Filter',widget,frameId:'0',documentId:'doc'};const input={...field,name:'Search',widget};const apply={elementId:'el_apply',role:'button',name:'Apply',widget,frameId:'0',documentId:'doc'};
    await observe(agent,task.id,powerPage(task.id,[open]));expect(task.pending?.tool).toBe('click');result(agent,task.id,{ok:true});await observe(agent,task.id,powerPage(task.id,[input,apply]));expect(task.pending?.tool).toBe('fill');result(agent,task.id,{ok:true});await observe(agent,task.id,powerPage(task.id,[{...input,value:identifier},apply]));expect(task.pending?.arguments.elementId).toBe('el_apply');result(agent,task.id,{ok:true});await observe(agent,task.id,powerPage(task.id,[],{dashboardEvidence:{filters:[{label:'Process Name filter',value:identifier}],visuals:[]}}));expect(task.state).toBe('COMPLETED');expect(decide).not.toHaveBeenCalled();
  });
  it('clears only its own selected row and tries the alternate scoped filter once',()=>{
    const before=powerPage('t');const flow=processWorkflow('filter '+identifier,before)!;const memory={tableInteraction:{clicked:{text:identifier,observationId:before.observationId}}};Object.assign(flow,{stage:'verify',route:'row',attempted:['row'],target:cell,beforeChecked:false,waits:2});const widget='Process Name filter';const filter={...field,name:'Search',widget};const selected=powerPage('t',[{...cell,selected:true},filter],{lastActionResult:{ok:true}});expect(nextProcess(flow,selected,memory)).toMatchObject({tool:'click'});expect(flow.stage).toBe('undo');const cleared=powerPage('t',[{...cell,selected:false},filter],{lastActionResult:{ok:true}});expect(nextProcess(flow,cleared,memory)).toMatchObject({tool:'fill',arguments:{value:identifier}});expect(flow.attempted).toEqual(['row','filter']);
  });
  it('asks about several process tables and never clicks an ambiguous target',()=>{
    const before=powerPage('t');const flow=processWorkflow('select '+identifier,before)!;nextProcess(flow,before,{});expect(nextProcess(flow,powerPage('t',[{...cell,searchMatch:true},{...cell,elementId:'el_second',tableName:'Another table',searchMatch:true}],{lastActionResult:{ok:true}}),{})).toMatchObject({type:'user_input_required'});
  });
  it('preserves preexisting selections and falls back for ambiguous filter controls or rich goals',()=>{
    const before=powerPage('t');const flow=processWorkflow('filter '+identifier,before)!;Object.assign(flow,{stage:'verify',route:'row',attempted:['row'],target:cell,beforeChecked:true,waits:2});expect(nextProcess(flow,powerPage('t',[{...cell,selected:true}],{lastActionResult:{ok:true}}),{})).toBeUndefined();expect(flow.failed).toBe(true);expect(processWorkflow('filter '+identifier+' then export',before)).toBeUndefined();
  });
  it('waits locally for rendering before trying the alternate route and undoes only its new checkbox',()=>{
    const before=powerPage('t');const flow=processWorkflow('filter '+identifier,before)!;const widget='Process Name filter';const checkbox={elementId:'el_check',role:'checkbox',name:identifier,widget,checked:false};
    Object.assign(flow,{stage:'verify',route:'filter',attempted:['filter'],changedOption:checkbox});
    const unchanged=powerPage('t',[cell,{...checkbox,checked:true}],{lastActionResult:{ok:true}});
    expect(nextProcess(flow,unchanged,{})).toMatchObject({tool:'wait_for_element'});expect(nextProcess(flow,unchanged,{})).toMatchObject({tool:'wait_for_element'});
    expect(nextProcess(flow,unchanged,{})).toMatchObject({tool:'uncheck',arguments:{elementId:'el_check'}});
    expect(nextProcess(flow,powerPage('t',[cell,checkbox],{lastActionResult:{ok:true}}),{})).toMatchObject({tool:'find_element'});
    expect(flow.attempted).toEqual(['filter','row']);
  });
  it('invalidates a recipe after navigation and never claims other user objectives are completed',()=>{
    const before=powerPage('t');const flow=processWorkflow('filter '+identifier,before)!;
    expect(nextProcess(flow,page('t',[cell]),{})).toBeUndefined();expect(flow.failed).toBe(true);
    const after=powerPage('t',[{...cell,selected:true}],{dashboardEvidence:{filters:[{label:'Process Name',value:identifier}],visuals:[]}});
    expect(verifyObjective({kind:'dashboard_filter',value:identifier},before,after,'filter '+identifier+' for June',{})).toBeUndefined();
    expect(verifyObjective({kind:'dashboard_filter',value:identifier},before,after,'filter another_process',{})).toBeUndefined();
  });
});
