import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { useApp } from "../AppContext";
import type { AuthUser, DocItem, DocumentAccessEvent, DocumentAccessPolicy } from "../types";

export function DocumentAccessDialog({ document, onClose }: { document: DocItem; onClose: () => void }) {
  const { toast } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [policy, setPolicy] = useState<DocumentAccessPolicy | null>(null);
  const [events, setEvents] = useState<DocumentAccessEvent[]>([]);
  const [wasPublic, setWasPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    let active = true;
    void Promise.all([api.documentAccessUsers(), api.documentAccess(document.id)])
      .then(([accounts, result]) => {
        if (!active) return;
        setUsers(accounts.users);
        setPolicy(result.access);
        setWasPublic(result.access.visibility === "public");
        setEvents(result.events);
      })
      .catch(reason => { if (active) setError((reason as Error).message); });
    return () => { active = false; element?.close(); };
  }, [document.id]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!policy || busy) return;
    if (!wasPublic && policy.visibility === "public" && !window.confirm("公开后，所有已登录账号都能读取此材料，并用于问答引用。确认公开？")) return;
    setBusy(true);
    setError("");
    try {
      await api.setDocumentAccess(document.id, policy);
      toast("阅读权限已保存并留痕");
      onClose();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="document-access-dialog" aria-labelledby="document-access-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={event => void save(event)}>
        <div className="modal-head"><h2 id="document-access-title">材料阅读权限</h2><button className="btn btn-ghost" type="button" onClick={onClose} disabled={busy}>关闭</button></div>
        <div className="document-access-body scroll-area">
          <strong>{document.name}</strong>
          <p className="warning-banner">材料可参与内部查重；阅读权限控制原文、问答引用、报告及导出中的对方证据。</p>
          {error && <p role="alert">{error}</p>}
          {!policy && !error && <p role="status">正在读取阅读权限…</p>}
          {policy && <>
            <label className="field"><span>材料归属账号</span><select value={policy.owner_username} onChange={event => setPolicy({ ...policy, owner_username: event.target.value })}>
              <option value="">未指定归属</option>
              {users.map(user => <option key={user.username} value={user.username}>{user.display_name || user.username}（{user.username}）</option>)}
            </select></label>
            <label className="field"><span>阅读范围</span><select value={policy.visibility} onChange={event => setPolicy({ ...policy, visibility: event.target.value as DocumentAccessPolicy["visibility"] })}>
              <option value="restricted">受控：归属账号、授权账号及受委托专家</option>
              <option value="public">公开：所有已登录账号</option>
            </select></label>
            <fieldset className="document-access-readers"><legend>额外阅读授权</legend>
              {users.filter(user => user.role !== "manager" && user.role !== "admin" && user.username !== policy.owner_username).map(user => <label key={user.username}>
                <input type="checkbox" checked={policy.readers.includes(user.username)} onChange={event => setPolicy({ ...policy, readers: event.target.checked ? [...policy.readers, user.username] : policy.readers.filter(name => name !== user.username) })} />
                <span>{user.display_name || user.username}（{user.username}）</span>
              </label>)}
            </fieldset>
            <p>管理人员可复核全部材料；专家本人任务对应的申报书保持可读。其他比对材料需要单独授权。</p>
            <details><summary>最近访问与授权记录（{events.length}）</summary><ul>{events.slice(0, 20).map((item, index) => <li key={index}>{item.created_at.replace("T", " ")} · {item.actor} · {item.action === "set_access" ? "权限变更" : "阅读"}</li>)}</ul></details>
          </>}
        </div>
        <div className="modal-actions"><button className="btn btn-primary" disabled={!policy || busy}>{busy ? "保存中…" : "保存阅读权限"}</button></div>
      </form>
    </dialog>
  );
}
