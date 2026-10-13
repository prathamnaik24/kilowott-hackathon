import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowRightLeft, Bot, CheckSquare, Mail, ShoppingBag, StickyNote, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import type { TimelineItem } from '../lib/types';
import { Button, cx, inputClass } from './ui';

const ICONS = {
  ORDER_PLACED: { icon: ShoppingBag, color: 'bg-sky-100 text-sky-700' },
  STATUS_CHANGE: { icon: ArrowRightLeft, color: 'bg-slate-100 text-slate-600' },
  NOTE: { icon: StickyNote, color: 'bg-yellow-100 text-yellow-700' },
  TASK: { icon: CheckSquare, color: 'bg-emerald-100 text-emerald-700' },
  EMAIL: { icon: Mail, color: 'bg-indigo-100 text-indigo-700' },
  AI_SUMMARY: { icon: Bot, color: 'bg-violet-100 text-violet-700' },
  WORKFLOW: { icon: Zap, color: 'bg-fuchsia-100 text-fuchsia-700' },
} as const;

const originLabel = (origin?: string) =>
  !origin || origin === 'user' ? null : origin === 'ai' ? 'AI' : origin.startsWith('workflow:') ? `Workflow · ${origin.slice(9)}` : origin;

export function Timeline({ items, customerId }: { items: TimelineItem[]; customerId: string }) {
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-6">
      {items.map((item) => {
        const { icon: Icon, color } = ICONS[item.kind] ?? ICONS.NOTE;
        const origin = originLabel(item.origin);
        return (
          <li key={item.id} className="relative">
            <span className={cx('absolute -left-[37px] grid h-6 w-6 place-items-center rounded-full ring-4 ring-white', color)}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className="font-medium text-slate-800">{item.title}</span>
              {item.status && <StatusPill status={item.status} />}
              {origin && <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-500">{origin}</span>}
            </div>
            <p className="text-xs text-slate-400">
              {dateTime(item.at)}
              {item.dueAt && item.kind === 'TASK' && ` · due ${dateTime(item.dueAt)}`}
            </p>
            {item.kind === 'EMAIL' && item.status === 'DRAFT' && item.activityId ? (
              <DraftReview item={item} customerId={customerId} />
            ) : (
              item.body && item.kind !== 'ORDER_PLACED' ? <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{item.body}</p> : item.body && <p className="text-sm text-slate-600">{item.body}</p>
            )}
            {item.kind === 'TASK' && item.status === 'OPEN' && item.activityId && <CompleteTask id={item.activityId} customerId={customerId} />}
          </li>
        );
      })}
    </ol>
  );
}

function StatusPill({ status }: { status: string }) {
  const style =
    status === 'DRAFT' ? 'bg-amber-100 text-amber-800' : status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600';
  return <span className={cx('rounded px-1.5 text-[11px] font-semibold', style)}>{status}</span>;
}

/** Human-in-the-loop: AI drafts are editable and only sent after explicit approval. */
function DraftReview({ item, customerId }: { item: TimelineItem; customerId: string }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState(item.title);
  const [body, setBody] = useState(item.body ?? '');
  const send = useMutation({
    mutationFn: () => api(`/activities/${item.activityId}/send`, { method: 'POST', body: { subject, body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline', customerId] }),
  });
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
      <textarea className={inputClass} rows={6} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Body" />
      <div className="flex items-center justify-between">
        <p className="text-xs text-amber-800">Draft — not sent until you approve.</p>
        <Button size="sm" onClick={() => send.mutate()} loading={send.isPending}>
          <Mail className="h-3.5 w-3.5" /> Approve & send
        </Button>
      </div>
    </div>
  );
}

function CompleteTask({ id, customerId }: { id: string; customerId: string }) {
  const qc = useQueryClient();
  const done = useMutation({
    mutationFn: () => api(`/activities/${id}`, { method: 'PATCH', body: { status: 'DONE' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline', customerId] }),
  });
  return (
    <Button variant="secondary" size="sm" className="mt-1" onClick={() => done.mutate()} loading={done.isPending}>
      Mark done
    </Button>
  );
}
