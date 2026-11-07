import {
  FolderKanban,
  FolderOpen,
  GitPullRequest,
  MessageSquareText,
  Network,
  ShieldCheck,
  TrendingUp,
  UserRoundCheck,
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
const ExpertLibraryPanel = workspaceComponent(() => import("../pages/MatchPage").then((module) => ({ default: module.ExpertLibraryPage })));
const ReviewPanel = workspaceComponent(() => import("../pages/ReviewPage").then((module) => ({ default: module.ReviewPage })));
const DossierPanel = workspaceComponent(() => import("../components/DossierWorkbench").then((module) => ({ default: module.DossierWorkbench })));
const LibraryPanel = workspaceComponent(() => import("../pages/LibraryPage").then((module) => ({ default: module.LibraryPage })));
const AdminPanel = workspaceComponent(() => import("../pages/AdminPage").then((module) => ({ default: module.AdminPage })));
const KnowledgeGraphPanel = workspaceComponent(() => import("../pages/KnowledgeGraphPage").then((module) => ({ default: module.KnowledgeGraphPage })));
const ReviewCasePanel = workspaceComponent(() => import("../pages/ReviewCasePage").then((module) => ({ default: module.ReviewCasePage })));
const ExpertReviewPanel = workspaceComponent(() => import("../pages/ExpertReviewPage").then((module) => ({ default: module.ExpertReviewPage })));

export interface WorkspaceView {
  path: string;
  title: string;
  description: string;
  icon: LucideIcon;
  permission?: string;
  showWorkspaceContext?: boolean;
  component: WorkspaceComponent;
}

export const WORKSPACE_VIEWS: WorkspaceView[] = [
  {
    path: "/chat",
    title: "智能问答",
    description: "根据资料回答，可查看引用依据",
    icon: MessageSquareText,
    showWorkspaceContext: false,
    component: ChatPanel,
  },
  {
    path: "/review-cases",
    title: "项目评审",
    description: "预审、专家审核与终审一条龙",
    icon: GitPullRequest,
    permission: "review-case",
    showWorkspaceContext: false,
    component: ReviewCasePanel,
  },
  {
    path: "/expert-review",
    title: "专家审核",
    description: "查看本人任务并提交独立审核意见",
    icon: UserRoundCheck,
    permission: "expert-review",
    showWorkspaceContext: false,
    component: ExpertReviewPanel,
  },
  {
    path: "/dossiers",
    title: "申报流程",
    description: "归档历史课题并核对材料情况",
    icon: FolderKanban,
    component: DossierPanel,
  },
  {
    path: "/review",
    title: "项目预审",
    description: "检查申报书并提供核对依据",
    icon: ShieldCheck,
    permission: "precheck",
    component: ReviewPanel,
  },
  {
    path: "/match",
    title: "查重匹配",
    description: "检查文本相似度并匹配专家",
    icon: Users,
    permission: "duplicate",
    component: MatchPanel,
  },
  {
    path: "/experts",
    title: "专家库",
    description: "管理专家资料和评审账号绑定",
    icon: Users,
    permission: "tool",
    showWorkspaceContext: false,
    component: ExpertLibraryPanel,
  },
  {
    path: "/graph",
    title: "知识图谱",
    description: "探索科研治理概念与关系",
    icon: Network,
    showWorkspaceContext: false,
    component: KnowledgeGraphPanel,
  },
  {
    path: "/trend",
    title: "文献趋势",
    description: "查看文献数量和主题变化",
    icon: TrendingUp,
    showWorkspaceContext: false,
    component: TrendPanel,
  },
  {
    path: "/library",
    title: "文档中心",
    description: "阅读并管理申报书、政策与文献",
    icon: FolderOpen,
    showWorkspaceContext: false,
    component: LibraryPanel,
  },
  {
    path: "/admin",
    title: "用户管理",
    description: "账号与角色管理（仅管理员可见）",
    icon: UserCog,
    permission: "admin",
    showWorkspaceContext: false,
    component: AdminPanel,
  },
];

export function visibleWorkspaceViews(can: (permission: string) => boolean): WorkspaceView[] {
  return WORKSPACE_VIEWS.filter((item) => !item.permission || can(item.permission)).map(item =>
    item.path === "/match" && !can("tool") ? { ...item, title: "材料查重", description: "检查本人申报材料的相似位置" } : item
  );
}
