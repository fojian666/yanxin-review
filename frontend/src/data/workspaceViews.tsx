import {
  FolderKanban,
  FolderOpen,
  MessageSquareText,
  Network,
  ShieldCheck,
  TrendingUp,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type WorkspaceComponent = LazyExoticComponent<ComponentType> & {
  preload: () => Promise<{ default: ComponentType }>;
};

function workspaceComponent(loader: () => Promise<{ default: ComponentType }>): WorkspaceComponent {
  let loading: Promise<{ default: ComponentType }> | undefined;
  const load = () => {
    loading ??= loader().catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  };
  return Object.assign(lazy(load), { preload: load });
}

const ChatPanel = workspaceComponent(() => import("../pages/ChatPage").then((module) => ({ default: module.ChatPage })));
const TrendPanel = workspaceComponent(() => import("../pages/TrendPage").then((module) => ({ default: module.TrendPage })));
const MatchPanel = workspaceComponent(() => import("../pages/MatchPage").then((module) => ({ default: module.MatchPage })));
const ReviewPanel = workspaceComponent(() => import("../pages/ReviewPage").then((module) => ({ default: module.ReviewPage })));
const DossierPanel = workspaceComponent(() => import("../components/DossierWorkbench").then((module) => ({ default: module.DossierWorkbench })));
const LibraryPanel = workspaceComponent(() => import("../pages/LibraryPage").then((module) => ({ default: module.LibraryPage })));
const AdminPanel = workspaceComponent(() => import("../pages/AdminPage").then((module) => ({ default: module.AdminPage })));
const KnowledgeGraphPanel = workspaceComponent(() => import("../pages/KnowledgeGraphPage").then((module) => ({ default: module.KnowledgeGraphPage })));

export interface WorkspaceView {
  path: string;
  title: string;
  description: string;
  icon: LucideIcon;
  permission?: string;
  component: WorkspaceComponent;
}

export const WORKSPACE_VIEWS: WorkspaceView[] = [
  {
    path: "/chat",
    title: "智能问答",
    description: "根据资料回答，可查看引用依据",
    icon: MessageSquareText,
    component: ChatPanel,
  },
  {
    path: "/dossiers",
    title: "历史课题",
    description: "归档历史课题并核对材料情况",
    icon: FolderKanban,
    component: DossierPanel,
  },
  {
    path: "/review",
    title: "项目预审",
    description: "检查申报书并提供核对依据",
    icon: ShieldCheck,
    permission: "review",
    component: ReviewPanel,
  },
  {
    path: "/match",
    title: "查重匹配",
    description: "检查文本相似度并匹配专家",
    icon: Users,
    permission: "tool",
    component: MatchPanel,
  },
  {
    path: "/graph",
    title: "知识图谱",
    description: "探索科研治理概念与关系",
    icon: Network,
    component: KnowledgeGraphPanel,
  },
  {
    path: "/trend",
    title: "文献趋势",
    description: "查看文献数量和主题变化",
    icon: TrendingUp,
    component: TrendPanel,
  },
  {
    path: "/library",
    title: "文档中心",
    description: "阅读并管理申报书、政策与文献",
    icon: FolderOpen,
    component: LibraryPanel,
  },
  {
    path: "/admin",
    title: "用户管理",
    description: "账号与角色管理（仅管理员可见）",
    icon: UserCog,
    permission: "admin",
    component: AdminPanel,
  },
];

export function visibleWorkspaceViews(can: (permission: string) => boolean): WorkspaceView[] {
  return WORKSPACE_VIEWS.filter((item) => !item.permission || can(item.permission));
}
