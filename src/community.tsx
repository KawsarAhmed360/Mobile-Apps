import { useEffect, useState, type FormEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, LoaderCircle, MessageCircle, Pencil, RefreshCw, Send, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import type { User } from '../shared/types';
import { api, post } from './api';
import { Empty, ErrorNotice, Field, Loading, SubmitButton } from './components';

interface ProductComment {
  id: number;
  productId: number;
  userId: number;
  author: string;
  authorRole: 'owner' | 'staff' | 'customer';
  body: string;
  likes: number;
  dislikes: number;
  myReaction: 'like' | 'dislike' | null;
  createdAt: string;
  updatedAt: string;
}
interface CommentPage { items: ProductComment[]; total: number; page: number; pages: number }

const commentTime = (value: string) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dhaka',
}).format(new Date(value));

export function ProductComments({ productId, user, revision, onLogin, onSuccess }: {
  productId: number; user: User | null; revision: number; onLogin: () => void; onSuccess: (message: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [localRevision, setLocalRevision] = useState(0);
  const [data, setData] = useState<CommentPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    api<CommentPage>(`/products/${productId}/comments?page=${page}&limit=10`)
      .then(result => {
        if (cancelled) return;
        if (result.page > result.pages) { setPage(Math.max(1, result.pages)); return; }
        setData(result);
      })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load comments.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId, page, revision, localRevision, user?.id]);

  const refresh = () => setLocalRevision(value => value + 1);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim() || posting) return;
    setPosting(true); setError('');
    try {
      await post<ProductComment>(`/products/${productId}/comments`, { body: body.trim() });
      setBody(''); setPage(1); refresh();
      onSuccess('Your comment is visible to the shop and other customers.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not post your comment.'); }
    finally { setPosting(false); }
  };
  const react = async (comment: ProductComment, value: 'like' | 'dislike') => {
    if (!user) { onLogin(); return; }
    if (busyId !== null) return;
    setBusyId(comment.id); setError('');
    try {
      const updated = await api<ProductComment>(`/comments/${comment.id}/reaction`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: comment.myReaction === value ? null : value }),
      });
      setData(current => current ? { ...current, items: current.items.map(item => item.id === updated.id ? updated : item) } : current);
      refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update your reaction.'); }
    finally { setBusyId(null); }
  };
  const edit = async (event: FormEvent, id: number) => {
    event.preventDefault();
    if (!editBody.trim() || busyId !== null) return;
    setBusyId(id); setError('');
    try {
      await api<ProductComment>(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body: editBody.trim() }) });
      setEditingId(null); refresh(); onSuccess('Comment updated.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update your comment.'); }
    finally { setBusyId(null); }
  };
  const remove = async (id: number) => {
    if (busyId !== null) return;
    setBusyId(id); setError('');
    try {
      await api<{ ok: boolean }>(`/comments/${id}`, { method: 'DELETE' });
      setDeleteId(null); refresh(); onSuccess('Comment deleted.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete the comment.'); }
    finally { setBusyId(null); }
  };

  return <section className="product-comments" aria-label="Product discussion">
    <div className="community-heading">
      <div><h3><MessageCircle size={20} /> Product discussion <span className="count-pill">{data?.total ?? 0}</span></h3><p>Comments are shared with the shop owner and everyone viewing this product.</p></div>
      <span className="live-label"><span /> Live</span>
    </div>
    {user ? <form className="comment-compose" onSubmit={submit}>
      <Field label="Add a comment"><textarea rows={3} value={body} onChange={event => setBody(event.target.value)} minLength={1} maxLength={2000} required placeholder="Ask a question or share something helpful…" disabled={posting} /></Field>
      <div className="comment-compose-footer"><small>Posting as <strong>{user.name}</strong></small><SubmitButton busy={posting} disabled={!body.trim()} className="button button-primary button-small"><Send size={16} />Post comment</SubmitButton></div>
    </form> : <div className="review-signin"><span>Join the conversation with your own account.</span><button className="text-button" onClick={onLogin}>Sign in to comment <Send size={15} /></button></div>}
    <ErrorNotice>{error || loadError}</ErrorNotice>
    {loadError && <button className="text-button" onClick={refresh}><RefreshCw size={15} />Retry comments</button>}
    {loading && !data ? <Loading label="Loading the conversation…" /> : !data?.items.length && !loadError ? <Empty title="Start a conversation" message="Questions and comments about this product will appear here for everyone." /> : <div className="comments-list" aria-busy={loading}>
      {data?.items.map(comment => <article className="comment-card" key={comment.id}>
        <div className="comment-avatar" aria-hidden="true">{comment.author.charAt(0).toUpperCase()}</div>
        <div className="comment-content">
          <div className="comment-meta"><div><strong>{comment.author}</strong>{comment.authorRole !== 'customer' && <span className="comment-role">{comment.authorRole === 'owner' ? 'Shop owner' : 'Shop staff'}</span>}{comment.userId === user?.id && <span className="comment-you">You</span>}</div><time dateTime={comment.createdAt}>{commentTime(comment.createdAt)}</time></div>
          {editingId === comment.id ? <form className="comment-edit" onSubmit={event => edit(event, comment.id)}><Field label="Edit your comment"><textarea rows={3} minLength={1} maxLength={2000} value={editBody} onChange={event => setEditBody(event.target.value)} required /></Field><div className="form-actions"><button type="button" className="button button-outline button-small" onClick={() => setEditingId(null)} disabled={busyId !== null}><X size={15} />Cancel</button><SubmitButton busy={busyId === comment.id} className="button button-primary button-small"><Check size={15} />Save changes</SubmitButton></div></form> : <p className="comment-body">{comment.body}</p>}
          {comment.updatedAt !== comment.createdAt && <small className="comment-edited">Edited</small>}
          <div className="comment-actions">
            <div className="comment-reactions" aria-label={`Reactions to ${comment.author}'s comment`}>
              <button type="button" className={comment.myReaction === 'like' ? 'selected' : ''} aria-pressed={comment.myReaction === 'like'} aria-label={`Like comment by ${comment.author}, ${comment.likes} likes`} onClick={() => react(comment, 'like')} disabled={busyId === comment.id}><ThumbsUp size={16} /><span aria-live="polite">{comment.likes}</span></button>
              <button type="button" className={comment.myReaction === 'dislike' ? 'selected negative' : ''} aria-pressed={comment.myReaction === 'dislike'} aria-label={`Dislike comment by ${comment.author}, ${comment.dislikes} dislikes`} onClick={() => react(comment, 'dislike')} disabled={busyId === comment.id}><ThumbsDown size={16} /><span aria-live="polite">{comment.dislikes}</span></button>
            </div>
            {comment.userId === user?.id && editingId !== comment.id && <button className="comment-text-action" onClick={() => { setEditingId(comment.id); setEditBody(comment.body); setDeleteId(null); }} disabled={busyId !== null}><Pencil size={13} />Edit</button>}
            {(comment.userId === user?.id || user?.role === 'owner') && <button className="comment-text-action delete" onClick={() => { setDeleteId(comment.id); setEditingId(null); }} disabled={busyId !== null}><Trash2 size={13} />Delete</button>}
            {busyId === comment.id && <LoaderCircle size={15} className="spin" aria-label="Updating comment" />}
          </div>
          {deleteId === comment.id && <div className="comment-delete-confirm" role="alert"><span>Delete this comment and its reactions?</span><div><button className="button button-outline button-small" onClick={() => setDeleteId(null)} disabled={busyId !== null}>Cancel</button><button className="button button-danger button-small" onClick={() => remove(comment.id)} disabled={busyId !== null}>Delete comment</button></div></div>}
        </div>
      </article>)}
    </div>}
    {data && data.pages > 1 && <div className="pagination comments-pagination"><span>Comments · page {page} of {data.pages}</span><div><button className="button button-outline button-small" onClick={() => setPage(value => value - 1)} disabled={page <= 1 || loading}><ChevronLeft size={15} />Previous</button><button className="button button-outline button-small" onClick={() => setPage(value => value + 1)} disabled={page >= data.pages || loading}>Next<ChevronRight size={15} /></button></div></div>}
  </section>;
}
