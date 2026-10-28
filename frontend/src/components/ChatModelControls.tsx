import { ChevronDown, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getChatModels } from "../api";
import { useApp } from "../AppContext";
import { STRENGTH_LABELS } from "../generation";
import type { ChatModelOption } from "../types";

export function ChatModelControls({ busy }: { busy: boolean }) {
  const { chatSelection, setChatSelection } = useApp();
  const [models, setModels] = useState<ChatModelOption[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<"model" | "strength" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const strengthButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const selected = models.find(model => model.id === chatSelection.model);
  const loaded = models.length > 0;

  useEffect(() => {
    let active = true;
    setError("");
    void getChatModels().then(data => { if (active) setModels(data.models); }).catch(err => {
      if (active) setError((err as Error).message);
    });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (!loaded) return;
    if (!selected?.available) setChatSelection({ model: "default", strength: "default" });
    else if (!selected.strengths.includes(chatSelection.strength)) setChatSelection({ ...chatSelection, strength: "default" });
  }, [loaded, selected, chatSelection, setChatSelection]);

  useEffect(() => { if (busy) setOpen(null); }, [busy]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>("input:checked:not(:disabled), input:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => {
    (open === "model" ? modelButton : strengthButton).current?.focus();
    setOpen(null);
  };
  const modelText = selected ? (selected.model || selected.label) : chatSelection.model === "default" ? "系统默认" : chatSelection.model;
  const strengths = selected?.strengths ?? ["default"];

  return (
    <div className="chat-model-controls" ref={root} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(null);
    }} onKeyDown={event => {
      if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <button type="button" ref={modelButton} className="chat-setting-trigger" disabled={busy || !loaded}
        aria-expanded={open === "model"} aria-controls="chat-model-panel" onClick={() => setOpen(open === "model" ? null : "model")}>
        <Settings2 size={14} /><span>模型：{modelText}</span><ChevronDown size={13} />
      </button>
      <button type="button" ref={strengthButton} className="chat-setting-trigger" disabled={busy || !loaded}
        aria-expanded={open === "strength"} aria-controls="chat-model-panel" onClick={() => setOpen(open === "strength" ? null : "strength")}>
        <span>强度：{STRENGTH_LABELS[chatSelection.strength]}</span><ChevronDown size={13} />
      </button>
      {error && <button type="button" className="chat-setting-retry" title={error} disabled={busy} onClick={() => setAttempt(value => value + 1)}>选项加载失败，重试</button>}
      {open && (
        <div className="chat-model-panel" id="chat-model-panel" ref={panel}>
          <div className="chat-model-panel-head"><strong>{open === "model" ? "选择模型" : "推理强度"}</strong>
            <button type="button" className="icon-btn" aria-label="关闭模型选项" onClick={close}><X size={16} /></button>
          </div>
          <fieldset><legend className="sr-only">{open === "model" ? "模型（单选）" : "推理强度（单选）"}</legend>
            {open === "model" ? models.map(model => (
              <label className={`chat-model-option${!model.available ? " unavailable" : ""}`} key={model.id}>
                <input type="checkbox" checked={chatSelection.model === model.id} disabled={!model.available || busy}
                  onChange={() => setChatSelection({ model: model.id, strength: "default" })} />
                <span><strong>{model.label}{model.model ? ` · ${model.model}` : ""}</strong>
                  <small>{model.id === "default" ? "系统默认 · 沿用后台配置" : model.reason || (model.id === "offline" ? "原文摘录，不调用大模型" : "已配置接口 · 仅用于接下来的问答")}</small></span>
              </label>
            )) : strengths.map(strength => (
              <label className="chat-model-option" key={strength}>
                <input type="checkbox" checked={chatSelection.strength === strength} disabled={busy}
                  onChange={() => setChatSelection({ ...chatSelection, strength })} />
                <span><strong>{STRENGTH_LABELS[strength]}</strong><small>{strength === "default" ? "沿用后台配置" : strength === "quick" ? "直接回答，缩短等待" : selected?.label.includes("千问") ? `思考预算：${{ low: 2048, high: 8192, max: 16384 }[strength]} tokens` : "增加推理投入，耗时与用量可能增加"}</small></span>
              </label>
            ))}
          </fieldset>
          <p>{open === "strength" && strengths.length === 1 ? "当前模型或后台配置未开放强度调节。" : "每组仅选一项，从下一条消息生效。"}</p>
        </div>
      )}
    </div>
  );
}
