// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiagnosticPanel, type DiagnosticLog, readableEvent } from './diagnostics';
const entry = (id:string, event:string, level:DiagnosticLog['level']='info',taskId='task-1'):DiagnosticLog => ({id,event,level,taskId,timestamp:'2026-10-07T10:00:00Z',source:'backend'});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('readable diagnostics',()=>{
  it('shows friendly events, hides protocol traffic, and filters tasks and severity',()=>{
    render(<DiagnosticPanel logs={[entry('1','task.started'),entry('2','browser.failed','warn','task-2'),entry('3','WebSocket receive: server.action_request','debug')]} onClear={vi.fn()} onBack={vi.fn()}/>);
    expect(screen.getByText('Task started')).toBeDefined();expect(screen.queryByText('Technical event')).toBeNull();
    fireEvent.change(screen.getByLabelText('Task'),{target:{value:'task-2'}});expect(screen.queryByText('Task started')).toBeNull();expect(screen.getByText('Browser action needs attention')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Severity'),{target:{value:'error'}});expect(screen.getByText('No events match these filters.')).toBeDefined();
  });
  it('puts JSON behind advanced details and copies the visible readable events',async()=>{
    const writeText=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{clipboard:{writeText}});
    render(<DiagnosticPanel logs={[{...entry('1','azure.request'),details:{taskId:'task-1'}},entry('2','transport.raw','debug')]} onClear={vi.fn()} onBack={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Copy readable logs'}));await screen.findByRole('button',{name:'Copied'});
    expect(writeText.mock.calls[0][0]).toContain('Request sent to Azure');expect(writeText.mock.calls[0][0]).not.toContain('task-1');expect(writeText.mock.calls[0][0]).not.toContain('transport.raw');
    fireEvent.click(screen.getByLabelText('Advanced details'));expect(screen.getByText('Technical event')).toBeDefined();expect(screen.getAllByText('Technical details')).toHaveLength(2);
  });
  it('explains stale targets and configuration readiness without claiming connection',()=>{
    expect(readableEvent({...entry('1','browser.failed','warn'),details:{code:'STALE_ELEMENT'}}).message).toContain('changed before the action ran');
    expect(readableEvent({...entry('2','Azure status checked'),details:{availability:'unverified'}}).message).toContain('access has not been verified');
  });
});
