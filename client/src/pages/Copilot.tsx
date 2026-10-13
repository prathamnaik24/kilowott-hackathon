import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Bot, ChevronRight, Send, User, Wrench } from 'lucide-react';
import { Button, Card, ErrorNote, PageHeader, cx, inputClass } from '../components/ui';
import { api } from '../lib/api';
import type { CopilotStep } from '../lib/types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  steps?: CopilotStep[];
}

const SUGGESTIONS = [
  'Which orders are most at risk right now and what should we do?',
  'Summarize Priya Sharma’s order history.',
  'Find customers with at least one cancelled order and create a follow-up task for each.',
  'Draft an apology email for every customer whose order is on hold.',
];

export function CopilotPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api<{ enabled: boolean; model: string | null; tools: string[] }>('/ai/status') });

  const ask = useMutation({
    mutationFn: (message: string) =>
      api<{ answer: string; steps: CopilotStep[] }>('/ai/copilot', {
        method: 'POST',
        body: { message, history: messages.map(({ role, content }) => ({ role, content })) },
      }),
    onSuccess: (r) => setMessages((m) => [...m, { role: 'assistant', content: r.answer, steps: r.steps }]),
  });

  const send = (text: string) => {
    if (!text.trim() || ask.isPending) return;
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    ask.mutate(text);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <>
      <PageHeader
        title="AI Copilot"
        subtitle={
          <>
            A tool-using agent over your CRM data. It can look up customers and orders, create tasks and save email drafts —{' '}
            <strong>it never sends emails</strong>; drafts wait for human approval.
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <div className="flex h-[60vh] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              {messages.length === 0 && (
                <div className="grid gap-2 md:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-lg border border-slate-200 p-3 text-left text-sm text-slate-600 hover:border-violet-300 hover:bg-violet-50">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={cx('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
                  <div className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full', m.role === 'user' ? 'bg-slate-200' : 'bg-violet-600 text-white')}>
                    {m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div className={cx('max-w-[85%] space-y-2 rounded-xl px-3.5 py-2.5 text-sm', m.role === 'user' ? 'bg-slate-100' : 'border border-slate-200 bg-white')}>
                    {m.steps && m.steps.length > 0 && <ToolTrace steps={m.steps} />}
                    <p className="whitespace-pre-wrap text-slate-800">{m.content}</p>
                  </div>
                </div>
              ))}
              {ask.isPending && <p className="pl-10 text-sm text-slate-400">Thinking and calling CRM tools…</p>}
              <ErrorNote error={ask.error} />
            </div>
            <form onSubmit={submit} className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
              <input className={inputClass} placeholder="Ask about customers, orders, risks…" value={input} onChange={(e) => setInput(e.target.value)} />
              <Button type="submit" loading={ask.isPending}><Send className="h-4 w-4" /></Button>
            </form>
          </div>
        </Card>
        <Card title="Agent setup">
          <p className="text-sm">
            Status:{' '}
            {status.data?.enabled ? <span className="font-medium text-emerald-600">connected</span> : <span className="font-medium text-amber-600">no LLM key</span>}
          </p>
          {status.data?.model && <p className="text-xs text-slate-500">Model: {status.data.model}</p>}
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Tools</p>
          <ul className="mt-1 space-y-1 font-mono text-xs text-slate-600">
            {status.data?.tools.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}

function ToolTrace({ steps }: { steps: CopilotStep[] }) {
  return (
    <details className="rounded-lg bg-slate-50 p-2 text-xs">
      <summary className="flex cursor-pointer items-center gap-1 text-slate-500">
        <Wrench className="h-3 w-3" /> Used {steps.length} tool call{steps.length > 1 ? 's' : ''}
        {steps.some((s) => s.mutates) && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">made changes</span>}
      </summary>
      <ol className="mt-2 space-y-1.5">
        {steps.map((s, i) => (
          <li key={i}>
            <p className="flex items-center gap-1 font-mono text-slate-700">
              <ChevronRight className="h-3 w-3" /> {s.tool}({JSON.stringify(s.args)})
            </p>
            <p className="truncate pl-4 font-mono text-slate-400">{s.resultPreview}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
