import { AnimatePresence, motion } from "framer-motion";
import { Upload } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { EASE } from "../motion";

const META: Record<string, { title: string; sub: string }> = {
  "/chat": { title: "智能问答", sub: "基于上传资料回答，逐条给出原文依据" },
  "/trend": { title: "文献趋势", sub: "从多年论文中识别主题热度、阶段变化与研究空白" },
  "/match": { title: "查重匹配", sub: "智能查重 + 专家画像匹配一体化工具" },
  "/review": { title: "本子预审", sub: "形式、诚信、查重与政策合规的辅助检查" },
  "/library": { title: "文档库", sub: "上传资料、管理索引、导入文献数据" },
  "/admin": { title: "用户管理", sub: "账号与角色管理（仅管理员可见）" },
};

export function Topbar() {
  const { pathname } = useLocation();
  const { health, openUpload, can } = useApp();
  const meta = META[pathname] ?? META["/chat"];
  const online = Boolean(health?.llm.configured);

  useEffect(() => {
    document.title = `${meta.title} · 研信智评`;
  }, [meta.title]);

  return (
    <header className="topbar" onDragStart={(event) => event.preventDefault()}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className="topbar-title"
          key={pathname}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.23, ease: EASE }}
        >
          <div className="eyebrow">RESEARCH INTEGRITY · AI REVIEW</div>
          <h1>{meta.title}</h1>
          <p>{meta.sub}</p>
        </motion.div>
      </AnimatePresence>
      <div className="topbar-actions">
        <span
          className={`mode-chip ${online ? "online" : ""}`}
          title={
            online
              ? `模型：${health?.llm.model}；接口：${health?.llm.base_url}`
              : "未配置千问 API，当前使用检索式回答。设置 QWEN_API_KEY / QWEN_BASE_URL / QWEN_MODEL 后自动启用。"
          }
        >
          <span className="status-dot" />
          {online ? `千问 · ${health?.llm.model}` : "离线演示"}
        </span>
        {can("upload") && (
          <motion.button
            className="btn btn-primary"
            onClick={() => openUpload()}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.34, ease: EASE }}
          >
            <Upload size={17} />
            上传文档
          </motion.button>
        )}
      </div>
    </header>
  );
}
