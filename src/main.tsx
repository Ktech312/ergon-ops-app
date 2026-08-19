import { Component, Fragment, StrictMode, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  Camera,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Image,
  LayoutDashboard,
  ListChecks,
  MapPin,
  MoreHorizontal,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  Upload,
  User,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  isRemotePersistenceConfigured,
  acquireTransactionLock,
  addFormSchemaField,
  addScheduleTemplatePhase,
  addTaskActivity,
  addTaskHardwareDependency,
  buildCatalogDatasheetStoragePath,
  buildDocumentStoragePath,
  checkIsAdmin,
  consumeOAuthRedirectSession,
  bulkCreateCatalogItems,
  createCatalogItem,
  createHandover,
  createNotification,
  createPresalesRule,
  addSalesQuoteLocation,
  deleteSalesQuoteLocation,
  addSalesQuoteLocationItem,
  updateSalesQuoteLocationItem,
  deleteSalesQuoteLocationItem,
  addSalesQuoteLocationImage,
  addProjectLocation,
  updateProjectLocation,
  deleteProjectLocation,
  addProjectLocationItem,
  updateProjectLocationItem,
  deleteProjectLocationItem,
  addProjectLocationImage,
  updateProjectLocationImageDescription,
  updateProjectLocationImageMeta,
  moveProjectLocationImage,
  deleteProjectLocationImage,
  getProjectLocationImageDownloadUrl,
  addProjectShippingAddress,
  addProjectShipment,
  updateProjectShipment,
  addProjectShipmentPhoto,
  deleteProjectShipmentPhoto,
  getShipmentPhotoDownloadUrl,
  createProjectFromClosedWonQuote,
  createProjectDocuments,
  createPurchaseOrder,
  createPurchaseRequestRemote,
  createSalesQuote,
  updateSalesQuoteStatus,
  deleteSalesQuote,
  updateSalesQuoteProposalFields,
  addSalesQuoteBomLines,
  deleteSalesQuoteBomLine,
  deleteSalesQuoteBomLinesByLocationSource,
  updateSalesQuoteBomLineCatalogLink,
  createScheduleTemplate,
  createSubmittal,
  createSubmittalShareToken,
  loadProposalTemplateSections,
  updateProposalTemplateSection,
  loadProposalsForQuote,
  createQuoteProposal,
  createQuoteProposalShareToken,
  fetchPublicQuoteProposal,
  respondToPublicQuoteProposal,
  loadSalesQuoteIntakeResponse,
  upsertSalesQuoteIntakeResponse,
  updateSalesQuoteInfo,
  createInvite,
  createSiteHardwareRule,
  loadSiteHardwareRules,
  updateSiteHardwareRule,
  deleteSiteHardwareRule,
  createTask,
  createTeamMember,
  ensureTeamMemberForSelf,
  deleteFormSchemaField,
  deletePresalesRule,
  deleteScheduleTemplatePhase,
  deleteTaskHardwareDependency,
  ensureOwnApprovalRequest,
  fetchPublicSubmittal,
  fetchInviteByToken,
  acceptInvite,
  loadInvites,
  revokeInvite,
  queuePendingSitePhoto,
  listPendingSitePhotos,
  removePendingSitePhoto,
  getCatalogDatasheetPublicUrl,
  getDocumentDownloadUrl,
  getQuoteImageDownloadUrl,
  grantAdmin,
  loadAllAdmins,
  loadAllAllowedViews,
  loadAllApprovalStatuses,
  loadAllKnownUsers,
  loadAllUserRoles,
  loadAuthSession,
  loadBuildTransactions,
  loadCatalogItems,
  loadCatalogPriceChangeRequests,
  createCatalogPriceChangeRequest,
  approveCatalogPriceChangeRequest,
  rejectCatalogPriceChangeRequest,
  loadFormSchema,
  loadFullBackupSnapshot,
  loadDeviceRecipes,
  loadHandoversForProject,
  loadInventoryItems,
  loadInventoryItemSkusByIds,
  loadInventoryMovements,
  loadLocalAppState,
  loadProjectAllocations,
  loadOwnAllowedViews,
  loadOwnRoleKeys,
  loadOwnApprovalStatus,
  loadAdminEmails,
  loadNotificationRules,
  loadNotifications,
  loadPresalesRules,
  loadProjectDocuments,
  loadProjectSites,
  loadPurchaseOrders,
  loadPurchaseRequests,
  loadSalesQuotes,
  loadRemoteAppState,
  loadAllTaskActivity,
  loadDeletedTasks,
  loadScheduleTemplates,
  loadStandardInstallTimes,
  loadSubmittalsForProject,
  loadTaskHardwareDependencies,
  loadTasks,
  loadTeamMembers,
  loadUserRoleMode,
  loadUsersByRole,
  markWelcomeSeen,
  recordNotificationDelivery,
  makeCatalogNumber,
  markAllNotificationsRead,
  markNotificationRead,
  refreshAuthSession,
  requestPasswordReset,
  resolveInventoryItemIdBySku,
  resolveProjectId,
  respondToPublicSubmittal,
  restoreFullBackupSnapshot,
  reviewUserApproval,
  revokeAdmin,
  saveDeviceRecipes,
  saveInventoryItems,
  saveLocalAppState,
  saveMovementsBuildsAllocations,
  saveProjectSites,
  saveRemoteAppState,
  saveUserRoleMode,
  releaseTransactionLock,
  setCatalogItemRetired,
  setUserAllowedViews,
  setPrimaryUserRole,
  setSecondaryUserRoles,
  signInWithGoogleRedirect,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  submitHandover,
  updateCatalogItem,
  updateFormSchemaField,
  updateHandoverResponses,
  updateNotificationRule,
  updateProjectDocumentStatusRemote,
  updatePasswordWithRecovery,
  updatePurchaseOrderStatus,
  updatePurchaseRequestRemote,
  updateSalesQuoteLocation,
  updateSalesQuoteLocationImageDescription,
  updateSalesQuoteLocationImageMeta,
  moveSalesQuoteLocationImage,
  deleteSalesQuoteLocationImage,
  updateTask,
  updateTaskHardwareDependencyStatus,
  updateTeamMember,
  upsertKnownUser,
  upsertStandardInstallTime,
  uploadCatalogDatasheetFile,
  uploadDocumentFile,
  companyLogoUrl,
  loadCompanyBranding,
  saveCompanyBranding,
  uploadCompanyLogo,
  type ApprovalStatus,
  type AuthSession,
  type BomLine,
  type BuildComponent,
  type BuildRecipe,
  type BuildTransaction,
  type CatalogItem,
  type CatalogPriceChangeField,
  type CatalogPriceChangeRequest,
  type CompanyBranding,
  type EOTask,
  type FormSchema,
  type FormSchemaField,
  type FullBackupSnapshot,
  type InventoryMovement,
  type KnownUser,
  type NotificationItem,
  type NotificationRule,
  type Part,
  type PersistedAppState,
  type PresalesHardwareRule,
  type PriceHistoryEntry,
  type ProjectAllocationHistory,
  type ProjectDocument,
  type ProjectHandover,
  type ProjectSite,
  type ProjectLocation,
  type ProjectLocationImage,
  type ProjectLocationItem,
  type ProjectShippingAddress,
  type ProjectShipment,
  type ProjectShipmentPhoto,
  type ProjectSubmittal,
  type PublicSubmittalView,
  type ProposalTemplateSection,
  type ProposalSnapshot,
  type SalesQuoteProposal,
  type PublicQuoteProposalView,
  type SalesQuoteIntakeResponse,
  type PurchaseLineCategory,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseRequest,
  type PurchaseUrl,
  type SalesQuote,
  type SalesQuoteBomLine,
  type SalesQuoteLocation,
  type SalesQuoteLocationImage,
  type SalesQuoteLocationItem,
  type TaskActivityEntry,
  type ScheduleTemplate,
  type ScheduleTemplatePhase,
  type ScopeOfWork,
  type StandardInstallTime,
  type SubmittalSnapshot,
  type TaskHardwareDependency,
  type TaskPriority,
  type TaskSection,
  type TaskStatus,
  type TeamMember,
  type SiteHardwareRule,
  type SiteHardwareMetric,
  type UserInvite,
  type PublicInviteView,
  type UserRoles,
  type UserStatus,
} from "./persistence";
import "./styles.css";

type View = "dashboard" | "purchasing" | "inventory" | "projects" | "sales" | "tasks" | "reports" | "saas_calendar" | "admin" | "library";

// PurchaseUrl, PriceHistoryEntry, and Part used to be defined locally; as of
// Phase 10c they're imported from persistence.ts (see the import block
// above) since inventory items are now backed by the real `inventory_items`
// / `inventory_balances` tables instead of the app_records blob.

const inventoryTags = ["VPU Part", "Edge Box Part", "Solar Part", "Server Part", "Network Part", "Power Part", "Field Hardware"];

// BuildComponent and BuildRecipe used to be defined locally; as of Phase 10d
// they're imported from persistence.ts (see the import block above) since
// equipment recipes are now backed by the real `equipment_types` /
// `equipment_bom_components` tables instead of the app_records blob.

type RoleMode = "warehouse" | "purchasing" | "pm" | "manager" | "sales" | "engineering" | "product_development" | "implementation" | "support" | "marketing";

const ALL_ROLE_KEYS: RoleMode[] = ["warehouse", "purchasing", "pm", "manager", "sales", "engineering", "product_development", "implementation", "support", "marketing"];

const ALL_TABS: View[] = ["dashboard", "purchasing", "inventory", "projects", "sales", "tasks", "reports", "saas_calendar"];

const TAB_LABELS: Record<View, string> = {
  dashboard: "Dashboard",
  purchasing: "Procurement",
  inventory: "Inventory",
  projects: "Projects",
  sales: "Sales",
  tasks: "Tasks",
  reports: "Reports",
  saas_calendar: "SaaS Calendar",
  admin: "Admin",
  library: "Library",
};

// Starting point when a role has no explicit per-user tab override. An admin
// can grant/restrict any individual user's exact tab list from the Admin page
// regardless of these defaults.
const DEFAULT_TABS_BY_ROLE: Record<RoleMode, View[]> = {
  warehouse: ["dashboard", "inventory", "projects", "tasks"],
  purchasing: ["dashboard", "purchasing", "inventory", "tasks", "reports"],
  pm: ["dashboard", "projects", "inventory", "sales", "tasks", "reports", "saas_calendar"],
  manager: ["dashboard", "purchasing", "inventory", "projects", "sales", "tasks", "reports", "saas_calendar"],
  sales: ["dashboard", "sales", "tasks", "reports", "saas_calendar"],
  engineering: ["dashboard", "projects", "inventory", "tasks", "reports"],
  product_development: ["dashboard", "projects", "tasks", "reports"],
  implementation: ["dashboard", "projects", "purchasing", "inventory", "tasks"],
  support: ["dashboard", "tasks", "reports"],
  marketing: ["dashboard", "reports", "tasks"],
};

// Mobile bottom nav's center button -- v1 is a navigation shortcut to
// whichever tab is that role's main job (E: "Sales = New Sale, PM =
// Projects"), not an auto-opened create form. The label is deliberately
// separate from TAB_LABELS so it can read as an action ("New Sale") even
// though it just navigates to the Sales tab, where the create flow lives.
const ROLE_QUICK_ACTION: Record<RoleMode, { view: View; label: string }> = {
  warehouse: { view: "inventory", label: "Inventory" },
  purchasing: { view: "purchasing", label: "Procurement" },
  pm: { view: "projects", label: "Projects" },
  manager: { view: "dashboard", label: "Dashboard" },
  sales: { view: "sales", label: "New Sale" },
  engineering: { view: "projects", label: "Projects" },
  product_development: { view: "projects", label: "Projects" },
  implementation: { view: "projects", label: "Projects" },
  support: { view: "tasks", label: "Tasks" },
  marketing: { view: "reports", label: "Reports" },
};

// Icon + label for each tab the mobile bottom nav can show -- kept in sync
// with the top nav's icon choices (main app-shell header) by hand.
const MOBILE_NAV_TAB_ICON: Record<View, (size: number) => React.ReactNode> = {
  dashboard: (size) => <LayoutDashboard size={size} />,
  purchasing: (size) => <ShoppingCart size={size} />,
  inventory: (size) => <Boxes size={size} />,
  projects: (size) => <ClipboardList size={size} />,
  sales: (size) => <DollarSign size={size} />,
  tasks: (size) => <ListChecks size={size} />,
  reports: (size) => <BarChart3 size={size} />,
  saas_calendar: (size) => <CalendarDays size={size} />,
  admin: (size) => <User size={size} />,
  library: (size) => <BookOpen size={size} />,
};

const TASK_SECTION_OPTIONS: Array<{ value: TaskSection; label: string }> = [
  { value: "warehouse", label: "Warehouse" },
  { value: "purchasing", label: "Procurement" },
  { value: "inventory", label: "Inventory" },
  { value: "projects", label: "Projects" },
  { value: "sales_catalog", label: "Sales - Product Catalog" },
  { value: "sales_quotes", label: "Sales - Site Builder" },
  { value: "engineering", label: "Engineering" },
  { value: "general", label: "General / Internal" },
];

const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: "to_do", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "ready_for_review", label: "Ready for Review" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
];

const TASK_PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const IMPACT_AREA_OPTIONS = ["Inventory", "Procurement", "Sales", "Projects", "Reports", "Other"];
type SyncStatus = "local" | "auth" | "loading" | "saving" | "synced" | "error";

// InventoryMovement, BuildTransaction, and ProjectAllocationHistory used to
// be defined locally; as of Phase 10e they're imported from persistence.ts
// (see the import block above) since these are now backed by the real
// inventory_movements / build_transactions / project_allocation_history
// tables instead of the app_records blob.

type PackageOption = {
  name: string;
  condition: string;
  costWithoutCameras: number;
  items: string[];
};

// PurchaseOrder and PurchaseOrderLine used to be defined locally with a
// fixed vendor/project union, backing a hardcoded array of 7 historical
// orders that couldn't be added to or changed; as of the Phase
// purchase-orders cutover they're imported from persistence.ts since
// they're now backed by the real `purchase_orders` / `purchase_order_lines`
// / `vendors` tables (see the import block above).

// PurchaseRequest used to be defined locally; as of Phase 10a it's imported
// from persistence.ts (see the import block above) since it's now backed by
// the real `purchase_requests` table instead of the app_records blob.

// UploadedDoc used to be a locally-defined blob shape; as of Phase 10b it's
// just an alias for the real ProjectDocument row shape from persistence.ts
// (see the import block above) so every existing UploadedDoc reference in
// this file keeps working unchanged.
type UploadedDoc = ProjectDocument;

// BomLine, ScopeOfWork, and ProjectSite used to be defined locally; as of
// Phase 10f they're imported from persistence.ts (see the import block
// above) since projects are now backed by the real `projects` /
// `project_scope_of_work` / `project_bom_lines` tables instead of the
// app_records blob.

type BomMaterialAction = "pull" | "order" | "direct";

type SalesQuoteExtractResponse = {
  confidence: "high" | "draft";
  mode: string;
  project: ProjectSite;
  extractedTextPreview: string;
};

const parts: Part[] = [
  {
    ref: "SKU-0001",
    name: "FLI Edge VPI",
    description: "NanoPC T6 compute unit",
    manufacturer: "FriendlyElec",
    category: "Base",
    cost: 295,
    stock: 14,
    reorderPoint: 6,
    tags: ["VPU Part", "Edge Box Part", "Server Part"],
    purchaseUrls: [{ id: 1, label: "FriendlyElec", url: "https://www.friendlyelec.com/" }],
    priceHistory: [
      { id: 1, date: "2026-02-14", vendor: "FriendlyElec", unitCost: 285, notes: "Initial BOM baseline" },
      { id: 2, date: "2026-07-15", vendor: "FriendlyElec", unitCost: 295, notes: "Current purchasing estimate" },
    ],
  },
  {
    ref: "SKU-0002",
    name: "Camera",
    description: "Camera, limit of 4. Prefer Axis",
    manufacturer: "Axis",
    category: "Base",
    cost: 500,
    stock: 18,
    reorderPoint: 8,
    tags: ["Field Hardware"],
    purchaseUrls: [
      { id: 1, label: "Preferred distributor", url: "" },
      { id: 2, label: "Backup source", url: "" },
    ],
    priceHistory: [
      { id: 1, date: "2026-03-04", vendor: "Distributor quote", unitCost: 475, notes: "Planning estimate" },
      { id: 2, date: "2026-07-12", vendor: "Axis channel", unitCost: 500, notes: "Current camera budget" },
    ],
  },
  {
    ref: "SKU-0003",
    name: "VPU case",
    description: "White steel junction box",
    manufacturer: "Joinfworld",
    category: "Base",
    cost: 255,
    stock: 9,
    reorderPoint: 4,
    tags: ["Edge Box Part", "Field Hardware"],
    purchaseUrls: [{ id: 1, label: "Amazon", url: "" }],
    priceHistory: [
      { id: 1, date: "2026-06-04", vendor: "Amazon", unitCost: 245, notes: "Previous enclosure order" },
      { id: 2, date: "2026-07-13", vendor: "Amazon", unitCost: 255, notes: "Recent order baseline" },
    ],
  },
  {
    ref: "SKU-0004",
    name: "Cellular Data Connection",
    description: "Internal LTE in Nano",
    manufacturer: "SixFab / Telit",
    category: "Communications",
    cost: 65,
    stock: 7,
    reorderPoint: 5,
    tags: ["VPU Part", "Edge Box Part", "Network Part"],
    purchaseUrls: [{ id: 1, label: "SixFab", url: "" }],
    priceHistory: [
      { id: 1, date: "2026-04-10", vendor: "SixFab", unitCost: 62, notes: "Early kit estimate" },
      { id: 2, date: "2026-07-15", vendor: "SixFab / Telit", unitCost: 65, notes: "Current planning cost" },
    ],
  },
  {
    ref: "SKU-0005",
    name: "External Antenna",
    description: "External LTE antenna",
    manufacturer: "Bingfu / Dixingtech",
    category: "Communications",
    cost: 30,
    stock: 11,
    reorderPoint: 8,
    tags: ["Edge Box Part", "Network Part"],
    purchaseUrls: [{ id: 1, label: "Amazon", url: "" }],
    priceHistory: [
      { id: 1, date: "2026-05-22", vendor: "Amazon", unitCost: 28, notes: "Planning estimate" },
      { id: 2, date: "2026-07-13", vendor: "Amazon", unitCost: 30, notes: "Recent order baseline" },
    ],
  },
  { ref: "SKU-0006", name: "External Cell Modem", description: "Industrial mobile router", manufacturer: "Ubiquiti", category: "Communications", cost: 225, stock: 5, reorderPoint: 3, tags: ["Network Part", "Edge Box Part"] },
  { ref: "SKU-0007", name: "Network Switch", description: "Industrial PoE network switch", manufacturer: "LinoVision", category: "Communications", cost: 110, stock: 6, reorderPoint: 6, tags: ["Network Part", "Edge Box Part", "Server Part"] },
  { ref: "SKU-0008", name: "Solar Panel", description: "12V 100W minimum, geography dependent", manufacturer: "Renogy", category: "Power", cost: 85, stock: 10, reorderPoint: 6, tags: ["Solar Part", "Power Part"] },
  { ref: "SKU-0009", name: "Solar Charger", description: "MPPT 75 charger", manufacturer: "Victron Energy", category: "Power", cost: 75, stock: 8, reorderPoint: 5, tags: ["Solar Part", "Power Part"] },
  { ref: "SKU-0010", name: "Solar Panel Mount Hardware", description: "Panel mounting hardware", manufacturer: "Renogy", category: "Power", cost: 66, stock: 13, reorderPoint: 6, tags: ["Solar Part", "Field Hardware"] },
  { ref: "SKU-0011", name: "Solar Panel to MPPT Connection Cable", description: "12/2 outdoor AWG connection cable", manufacturer: "Field supply", category: "Power", cost: 25, stock: 15, reorderPoint: 10, tags: ["Solar Part", "Power Part", "Field Hardware"] },
  { ref: "SKU-0012", name: "Battery", description: "LiFEPO4 12VDC at 300Wh", manufacturer: "GreenOE", category: "Power", cost: 65, stock: 12, reorderPoint: 6, tags: ["Solar Part", "Power Part", "Edge Box Part"] },
  { ref: "SKU-0013", name: "Smart Shunt", description: "300A shunt", manufacturer: "Victron Energy", category: "Power", cost: 85, stock: 6, reorderPoint: 6, tags: ["Solar Part", "Power Part"] },
  { ref: "SKU-0014", name: "Smart Shunt Energy Cable", description: "VE.Direct to USB interface", manufacturer: "Victron Energy", category: "Power", cost: 35, stock: 10, reorderPoint: 7, tags: ["Solar Part", "Power Part"] },
  { ref: "SKU-0015", name: "AC Charger", description: "AC charging adapter", manufacturer: "Amazon", category: "Power", cost: 25, stock: 16, reorderPoint: 8, tags: ["Power Part", "Edge Box Part", "Server Part"] },
  { ref: "SKU-0016", name: "Power Junction Box", description: "Field wiring enclosure", manufacturer: "Field supply", category: "Power", cost: 45, stock: 9, reorderPoint: 5, tags: ["Power Part", "Edge Box Part", "Field Hardware"] },
  { ref: "SKU-0017", name: "LED Light", description: "Optional additional lighting", manufacturer: "Amazon", category: "Lighting", cost: 145, stock: 4, reorderPoint: 3, tags: ["Field Hardware"] },
  { ref: "SKU-0018", name: "Pole for LED Light", description: "16ft pole for LED light", manufacturer: "Field supply", category: "Lighting", cost: 175, stock: 2, reorderPoint: 2, tags: ["Field Hardware"] },
  { ref: "SKU-0019", name: "32in Display", description: "Screen technology TBD", manufacturer: "TBD", category: "Display", cost: 3000, stock: 1, reorderPoint: 1, tags: ["Field Hardware"] },
  { ref: "SKU-0020", name: "2U Server Chassis", description: "Rosewill RSV-Z2006", manufacturer: "Rosewill", category: "Build", cost: 149.99, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "NewEgg", url: "" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "NewEgg", unitCost: 149.99, notes: "Required Enterprise VPU server chassis." }] },
  { ref: "SKU-0021", name: "Z890 Motherboard", description: "ASRock Z890 Taichi", manufacturer: "ASRock", category: "Build", cost: 199.99, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "NewEgg", url: "" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "NewEgg", unitCost: 199.99, notes: "Required Enterprise VPU motherboard." }] },
  { ref: "SKU-0022", name: "Intel Core Ultra 7 CPU", description: "Intel BX80768265KF", manufacturer: "Intel", category: "Build", cost: 298.98, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "NewEgg", url: "" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "NewEgg", unitCost: 298.98, notes: "Required Enterprise VPU CPU." }] },
  { ref: "SKU-0023", name: "Memory/RAM", description: "Crucial Pro CP2K16G64C38U5B", manufacturer: "Crucial Pro", category: "Build", cost: 468.99, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "NewEgg", url: "" }, { id: 2, label: "Amazon alternate", url: "https://www.amazon.com/CORSAIR-Vengeance-6400MHz-CL36-48-48-104-Computer/dp/B0DJW4PKY3/ref=sr_1_2?crid=DYVWKIR6I6PT&dib=eyJ2IjoiMSJ9.PW1mQBTeYY8Plmhfj2dd76_7AoW9L8Xt17JhC7JZePpRCUxGwoj_YHmRQBgWZtRJq6wBc4EAPb__KA-6qkDlKvF_wsPgmWFr3Yx-4_ITRkyhP5nVnap7D0Xg3kh-uzAxr4HWyQJH4d_GWkpqVTMS-5rPVJ12ZfmsNHb9xk_5yZCv702NS0Nc4BXjd9r44DGBencOGLMVus1zx0fs_nm9XMuG1AG5DedCaSKwKuZCHKs.iaNJ7wUe6CoY7Ft3xNMAFN8BWfu0g9W4LaA5BOsUZT4&dib_tag=se&keywords=crucial+ddr5+6400+32gb&qid=1782751978&sprefix=crucial+ddr5+6400+32gb%2Caps%2C193&sr=8-2&ufe=app_do%3Aamzn1.fos.1740e8b9-be2d-46a4-a376-9d8efb903409" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "NewEgg", unitCost: 468.99, notes: "Can be substituted for any dual DDR5 6400 memory modules." }] },
  { ref: "SKU-0024", name: "Nvidia RTX5070 GPU", description: "Gigabyte N5070WF3OC-12GD", manufacturer: "Gigabyte", category: "Build", cost: 635.99, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "NewEgg", url: "" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "NewEgg", unitCost: 635.99, notes: "Can be substituted for any RTX5070 GPU with minimum 12GB RAM." }] },
  { ref: "SKU-0025", name: "Samsung 990 Pro SSD", description: "Samsung MZ-V9P1T0B/AM", manufacturer: "Samsung", category: "Build", cost: 219.99, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "NewEgg", url: "" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "NewEgg", unitCost: 219.99, notes: "Required Enterprise VPU SSD." }] },
  { ref: "SKU-0026", name: "Seagate 3.5in Drive", description: "Seagate ST2000DM001", manufacturer: "Seagate", category: "Build", cost: 85, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "NewEgg", url: "" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "NewEgg", unitCost: 85, notes: "Required Enterprise VPU storage drive." }] },
  { ref: "SKU-0027", name: "Corsair RMx Series Power", description: "Corsair RM1000x", manufacturer: "Corsair", category: "Build", cost: 209.99, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part", "Power Part"], purchaseUrls: [{ id: 1, label: "NewEgg", url: "" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "NewEgg", unitCost: 209.99, notes: "Required Enterprise VPU power supply." }] },
  { ref: "SKU-0028", name: "CPU Cooler", description: "SilverStone XE02-1700S", manufacturer: "SilverStone", category: "Build", cost: 72.2, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "NewEgg", url: "" }, { id: 2, label: "Amazon alternate", url: "https://www.amazon.com/SilverStone-Technology-XE02-1700S-Workstation-SST-XE02-1700S/dp/B0D9MYWPQH/ref=sr_1_3?crid=9B8TQAPEVDPR&dib=eyJ2IjoiMSJ9.LYg9js1OGlXg7viJ6l-fzBgzXofSXiLCojlFaOQCvRnHDrXBG8tELkpD1cVjH7sfKuDz0cPBHYOa3ODBO3z05ihbi4-L1kI1WXjfW6CYvmKc7yHs32LKS4Xgb0t6NCEw7Z6h_zfuq4Gp_yFHD2m3k8_lr7aHcsS92HAKoZUiMUktSiecLJU-Fo9Qg5TzkQHMAIOITF2njfD8Ebvv7V_kPoT_mVYtz01uA521bvBbjjU.qLUNcEZbydxBkPw2jd5OCXIJVg0Yqdh8rQ_cz3okdMk&dib_tag=se&keywords=silverstone%2B2u%2Bcpu%2Bcooler&qid=1782752073&sprefix=silverstone%2B2u%2Bcpu%2Bcoole%2Caps%2C176&sr=8-3&th=1" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "NewEgg", unitCost: 72.2, notes: "Can be substituted for any 2U CPU cooler for LGA1700/LGA1851." }] },
  { ref: "SKU-0029", name: "PCIe Ribbon Cable", description: "LinkUP PCIe riser/ribbon cable", manufacturer: "LinkUP", category: "Build", cost: 65.96, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "Amazon", url: "https://www.amazon.com/dp/B0FLGRQQ8W?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "Amazon", unitCost: 65.96, notes: "Required Enterprise VPU PCIe ribbon cable." }] },
  { ref: "SKU-0030", name: "Fan Extension Cable", description: "Cable Matters fan extension cable", manufacturer: "Cable Matters", category: "Build", cost: 8.88, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "Amazon", url: "https://www.amazon.com/dp/B07PXLHNZ6?ref=ppx_yo2ov_dt_b_fed_asin_title" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "Amazon", unitCost: 8.88, notes: "Required Enterprise VPU fan extension cable." }] },
  { ref: "SKU-0031", name: "PiKVM Mini V4", description: "PiKVM Mini V4", manufacturer: "PiKVM", category: "Build", cost: 279.95, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "Amazon", url: "https://www.amazon.com/dp/B0CV93FNLF?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "Amazon", unitCost: 279.95, notes: "Required Enterprise VPU remote KVM." }] },
  { ref: "SKU-0032", name: "HDMI for PiKVM", description: "HDMI cable for PiKVM", manufacturer: "TBD", category: "Build", cost: 10.99, stock: 0, reorderPoint: 2, tags: ["VPU Part", "Server Part"], purchaseUrls: [{ id: 1, label: "Amazon", url: "https://www.amazon.com/dp/B0G255DYLS?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1" }], priceHistory: [{ id: 1, date: "2026-07-27", vendor: "Amazon", unitCost: 10.99, notes: "Required Enterprise VPU PiKVM HDMI cable." }] },
];

const buildRecipes: BuildRecipe[] = [
  {
    name: "Enterprise VPU Server",
    outputName: "Enterprise VPU Server",
    description: "Internal server build assembled from purchased compute, storage, power, rack, and hardware components.",
    components: [
      { itemName: "2U Server Chassis", qty: 1 },
      { itemName: "Z890 Motherboard", qty: 1 },
      { itemName: "Intel Core Ultra 7 CPU", qty: 1 },
      { itemName: "Memory/RAM", qty: 1 },
      { itemName: "Nvidia RTX5070 GPU", qty: 1 },
      { itemName: "Samsung 990 Pro SSD", qty: 1 },
      { itemName: "Seagate 3.5in Drive", qty: 1 },
      { itemName: "Corsair RMx Series Power", qty: 1 },
      { itemName: "CPU Cooler", qty: 1 },
      { itemName: "PCIe Ribbon Cable", qty: 1 },
      { itemName: "Fan Extension Cable", qty: 1 },
      { itemName: "PiKVM Mini V4", qty: 1 },
      { itemName: "HDMI for PiKVM", qty: 1 },
    ],
  },
  {
    name: "VPU Edge Box",
    outputName: "VPU Edge Box",
    description: "Standard edge enclosure for powered parking garage or lot locations.",
    components: [
      { itemName: "FLI Edge VPI", qty: 1 },
      { itemName: "VPU case", qty: 1 },
      { itemName: "Network Switch", qty: 1 },
      { itemName: "Power Junction Box", qty: 1 },
      { itemName: "AC Charger", qty: 1 },
    ],
  },
  {
    name: "VPU Edge Box with Solar",
    outputName: "VPU Edge Box with Solar",
    description: "Edge enclosure plus solar power package for locations with no reliable site power.",
    components: [
      { itemName: "FLI Edge VPI", qty: 1 },
      { itemName: "VPU case", qty: 1 },
      { itemName: "Cellular Data Connection", qty: 1 },
      { itemName: "External Antenna", qty: 1 },
      { itemName: "Network Switch", qty: 1 },
      { itemName: "Solar Panel", qty: 1 },
      { itemName: "Solar Charger", qty: 1 },
      { itemName: "Solar Panel Mount Hardware", qty: 1 },
      { itemName: "Solar Panel to MPPT Connection Cable", qty: 1 },
      { itemName: "Battery", qty: 1 },
      { itemName: "Smart Shunt", qty: 1 },
      { itemName: "Power Junction Box", qty: 1 },
    ],
  },
];

const packageOptions: PackageOption[] = [
  {
    name: "Constant Power + WiFi",
    condition: "Customer has constant power to camera location and WiFi.",
    costWithoutCameras: 870,
    items: ["FLI Edge VPI", "Camera", "VPU case", "Network Switch", "Battery", "Smart Shunt", "Smart Shunt Energy Cable", "AC Charger", "Power Junction Box"],
  },
  {
    name: "Intermittent Power + WiFi",
    condition: "Customer has intermittent power to camera location and WiFi.",
    costWithoutCameras: 1121,
    items: ["FLI Edge VPI", "Camera", "VPU case", "Network Switch", "Solar Panel", "Solar Charger", "Solar Panel Mount Hardware", "Solar Panel to MPPT Connection Cable", "Battery", "Smart Shunt", "Smart Shunt Energy Cable", "AC Charger", "Power Junction Box"],
  },
  {
    name: "Intermittent Power + No WiFi",
    condition: "Customer has intermittent power to camera location and no WiFi.",
    costWithoutCameras: 1190,
    items: ["FLI Edge VPI", "Camera", "VPU case", "Cellular Data Connection", "External Antenna", "External Cell Modem", "Network Switch", "Battery", "Smart Shunt", "Smart Shunt Energy Cable", "AC Charger", "Power Junction Box"],
  },
  {
    name: "No Power + WiFi",
    condition: "Customer has no power to camera location and WiFi.",
    costWithoutCameras: 1121,
    items: ["FLI Edge VPI", "Camera", "VPU case", "Network Switch", "Solar Panel", "Solar Charger", "Solar Panel Mount Hardware", "Solar Panel to MPPT Connection Cable", "Battery", "Smart Shunt", "Smart Shunt Energy Cable", "AC Charger", "Power Junction Box"],
  },
  {
    name: "No Power + No WiFi",
    condition: "Customer has no power to camera location and no WiFi.",
    costWithoutCameras: 1441,
    items: ["FLI Edge VPI", "Camera", "VPU case", "Cellular Data Connection", "External Antenna", "External Cell Modem", "Network Switch", "Solar Panel", "Solar Charger", "Solar Panel Mount Hardware", "Solar Panel to MPPT Connection Cable", "Battery", "Smart Shunt", "Smart Shunt Energy Cable", "AC Charger", "Power Junction Box"],
  },
];

// The 7 historical orders that used to be hardcoded here now live in the
// purchase_orders/purchase_order_lines tables (seeded by migration 032) and
// are loaded into React state (see loadPurchaseOrders in the App component)
// alongside any new orders created through the real "New Purchase Order"
// form in the Purchasing view.

const blankSow: ScopeOfWork = {
  summary: "Define the garage or lot scope, included modules, parking guidance goals, and expected outcome.",
  preparation: "Confirm site requirements, drawings, use cases, and functional specification before ordering equipment.",
  infrastructure: "Confirm power, conduit, network drops, internet, mounting surfaces, and client-provided equipment.",
  installation: "Coordinate access, safety requirements, equipment mounting, cabling, and final terminations.",
  commissioning: "Configure hardware and software, verify connectivity, set camera fields of view, and validate sign data.",
  fineTuning: "Audit counting results, tune system accuracy, and coordinate go-live when the system is stable.",
  assumptions: "Client will provide required access, network path, and timely approval of final installation details.",
  exclusions: "Tax, permits, major infrastructure work, and third-party rework are outside the base scope unless added.",
};

const emeraldQueenImportedProject: ProjectSite = {
  ref: "PRJ-2026-0004",
  name: "Emerald Queen Tacoma - New Garage",
  client: "Emerald Queen Casino & Hotel",
  type: "Parking Garage",
  address: "Tacoma, WA - new construction parking garage",
  owner: "Steven Oakes / Sales",
  status: "Planning",
  due: "TBD",
  package: "Total occupancy guidance system with full matrix signage",
  cameras: 11,
  allocated: 307225,
  salesQuoteFile: "EnSight - New Garage - Emerald Queen Tacoma Casino & Hotel - Parking Occupancy Management & Guidance Proposal - February 11th, 2026.pdf",
  siteNotes: "Imported from sales proposal dated February 11, 2026. Includes occupancy management, guidance signage, LPR, level counting, and software/support scope.",
  sow: {
    summary: "Provide a parking occupancy management and guidance system for the new Emerald Queen parking garage with real-time occupancy/utilization data, entrance and interior full matrix signs, LPR at entrance/exit points, level counting cameras, and EnSightful portal reporting.",
    preparation: "Agree on functional specification and use cases, then order equipment. Equipment is received at the EnSight office for programming and factory acceptance testing before installation scheduling.",
    infrastructure: "Cat6 conduit and cable paths are needed to each camera, sign, and onsite server. Signage requires 120VAC before installation. Client-provided network equipment is excluded from the base quote.",
    installation: "Client electrician/installation team installs the EnSight system. Proposal estimates approximately 4-6 weeks for a project of this size.",
    commissioning: "After equipment is installed and connected to network, set camera fields of view, install/configure FLI counting software, verify counting, push data to Aggregator/signage, and confirm data reaches the EnSightful portal.",
    fineTuning: "Fine-tuning period is estimated at 2-3 weeks. Team audits results, optimizes accuracy, agrees on go-live date, and turns signs on for occupancy display.",
    assumptions: "Existing rack/UPS assumed in garage data closet. Client provides managed switches/network equipment, segmented network access, remote access utility approval, 120V signage power, and annual SSSA.",
    exclusions: "Tax, installation/infrastructure, switches, routers, WAPs, UPSs, scanning/X-raying, bonds, permits, certifications, engineered drawings, foundation design, and third-party rework.",
  },
  bom: [
    { item: "EnSightful Edge Vision Processing Unit", qty: 1, status: "Need Quote", requestSpeed: "ASAP", notes: "One per site; proposal notes max 18 cameras per server" },
    { item: "Network equipment", qty: 1, status: "Need Quote", requestSpeed: "ASAP", notes: "Excluded from proposal; client-provided managed switches/network equipment" },
    { item: "EnSight Eyes vehicle counting camera and software", qty: 5, status: "Need Quote", requestSpeed: "ASAP", notes: "Vehicle counting camera/software scope" },
    { item: "Dual lens camera for FLI counting and rear plate LPR", qty: 6, status: "Need Quote", requestSpeed: "ASAP", notes: "Includes FLI and LPR licenses" },
    { item: "Full Matrix Display - 2ft H x 7ft W - 5mm", qty: 7, status: "Need Quote", requestSpeed: "ASAP", notes: "Entrance/interior guidance signage" },
    { item: "Full Matrix Display - 6ft H x 4.5ft W - 5mm", qty: 4, status: "Need Quote", requestSpeed: "ASAP", notes: "Large full matrix display signage" },
    { item: "Sign mount hardware", qty: 11, status: "Need Quote", requestSpeed: "ASAP", notes: "Proposal lists 4 plus 7 sign mount hardware lines" },
    { item: "EnSight sign controller", qty: 11, status: "Need Quote", requestSpeed: "ASAP", notes: "Smart sign control hardware" },
    { item: "Remote implementation services", qty: 40, status: "Need Quote", requestSpeed: "Standard", notes: "PM, engineering/drawings, and software configuration hours" },
    { item: "On-site commissioning and go-live support", qty: 56, status: "Need Quote", requestSpeed: "Standard", notes: "40 commissioning hours plus 16 go-live support hours" },
    { item: "Travel and related expenses", qty: 1, status: "Need Quote", requestSpeed: "Standard" },
    { item: "Shipping", qty: 1, status: "Need Quote", requestSpeed: "Standard" },
    { item: "Annual SSSA", qty: 1, status: "Need Quote", requestSpeed: "Future", notes: "$18,325 annual software and support services agreement" },
  ],
};

const projects: ProjectSite[] = [
  {
    ref: "PRJ-2026-0001",
    name: "NNSB 37th Street",
    client: "Newport News Shipbuilding",
    type: "Parking Garage",
    address: "37th Street garage, Newport News, VA",
    owner: "Projects / Implementation",
    status: "Procurement",
    due: "Aug 09",
    package: "Garage camera + single space sensor rollout",
    cameras: 90,
    allocated: 48250,
    siteNotes: "Large garage install with cameras, VPU hardware, outdoor PoE boxes, UPS units, sign controllers, VMS signs, and sensor field equipment.",
    sow: {
      ...blankSow,
      summary: "Garage camera and single-space sensor rollout for Newport News Shipbuilding with field networking, UPS, signage, and sensor equipment.",
      infrastructure: "Outdoor PoE boxes, UPS, managed switching, sign posts, and sensor base stations need to be planned before purchasing.",
    },
    bom: [
      { item: "Single Lens Camera", qty: 90, status: "Ordered", requestSpeed: "ASAP", po: "#1225", notes: "Camera coverage for garage lanes and zones" },
      { item: "VPU", qty: 6, status: "Need Quote", requestSpeed: "ASAP", notes: "Video processing units for garage deployment" },
      { item: "Outdoor PoE switch with enclosure", qty: 20, status: "Need Quote", requestSpeed: "ASAP", notes: "Field network boxes for camera/sensor runs" },
      { item: "Outdoor UPS for PoE boxes", qty: 20, status: "Need Quote", requestSpeed: "ASAP", notes: "Power backup at distributed PoE locations" },
      { item: "Parksol RGB single space sensor", qty: 73, status: "Need Quote", requestSpeed: "ASAP", notes: "Sensor count from PM hardware tracker" },
      { item: "VMS display signage", qty: 126, status: "Ordered", requestSpeed: "Standard", notes: "Mixed 8x57, 15x57, and monument signs" },
    ],
  },
  {
    ref: "PRJ-2026-0002",
    name: "Straub Medical HI",
    client: "Straub Medical",
    type: "Parking Garage",
    address: "10225 Prospect Ave, Santee CA 92071",
    owner: "Chris Scheppmann",
    status: "Procurement",
    due: "Jul 30",
    package: "Garage server, camera, sign, and UPS package",
    cameras: 63,
    allocated: 28650,
    siteNotes: "Current purchasing reference for the NeweggBusiness orders. Hardware includes servers, storage, GPUs, camera coverage, sign equipment, and UPS support.",
    sow: {
      ...blankSow,
      summary: "Parking garage deployment for Straub Medical with camera coverage, server/VPU hardware, UPS support, and sign equipment.",
      infrastructure: "Confirm rack, UPS, switch, sign power, and camera cabling requirements before releasing remaining orders.",
    },
    bom: [
      { item: "Dual Lens Camera", qty: 33, status: "Ordered", requestSpeed: "ASAP", po: "1222" },
      { item: "Single Lens Camera", qty: 30, status: "Ordered", requestSpeed: "ASAP", po: "1222" },
      { item: "VPU", qty: 11, status: "Need Quote", requestSpeed: "ASAP" },
      { item: "Server UPS", qty: 11, status: "Need Quote", requestSpeed: "ASAP" },
      { item: "Switch UPS / rack mounted booster", qty: 9, status: "Need Quote", requestSpeed: "ASAP" },
      { item: "Interior signs and wall brackets", qty: 48, status: "Not started", requestSpeed: "Standard" },
    ],
  },
  {
    ref: "PRJ-2026-0003",
    name: "East Central Garage",
    client: "East Central",
    type: "Parking Garage",
    address: "133 S. 40th Street, Springdale, AR 72762",
    owner: "Projects / Implementation",
    status: "Staging",
    due: "Aug 15",
    package: "Garage camera, VPU, sign controller, and sensor package",
    cameras: 7,
    allocated: 12400,
    siteNotes: "Several items completed or shipped. Keep as a good example of PM hardware request turning into purchasing and inventory movement.",
    sow: {
      ...blankSow,
      summary: "Garage deployment with cameras, VPU, sign controllers, Parksol sensors, PoE switch, UPS, and server rack.",
      commissioning: "Completed hardware lines should move toward inventory receiving, staging, and commissioning closeout.",
    },
    bom: [
      { item: "Single Lens Camera", qty: 7, status: "Completed", requestSpeed: "ASAP", notes: "Not ordered in source tracker" },
      { item: "PoE Switch", qty: 1, status: "Completed", requestSpeed: "ASAP" },
      { item: "Server UPS", qty: 1, status: "Completed", requestSpeed: "ASAP", notes: "Ship date 2/27/2026" },
      { item: "Server Rack", qty: 1, status: "Completed", requestSpeed: "ASAP", notes: "Ship date 2/28/2026" },
      { item: "Single Space Sensors - Parksol", qty: 20, status: "Completed", requestSpeed: "ASAP" },
      { item: "Sign Controller", qty: 3, status: "Completed", requestSpeed: "ASAP" },
    ],
  },
  {
    ref: "PRJ-2026-0005",
    name: "Lakeside Gate",
    client: "Demo Client",
    type: "Surface Lot",
    address: "TBD site address",
    owner: "Project Management",
    status: "Staging",
    due: "Jul 30",
    package: "Constant Power + WiFi",
    cameras: 2,
    allocated: 1740,
    siteNotes: "Small surface lot project for the standard package matrix.",
    sow: blankSow,
    bom: [
      { item: "FLI Edge VPI", qty: 1, status: "From Inventory", requestSpeed: "Standard" },
      { item: "Camera", qty: 2, status: "Need Quote", requestSpeed: "Standard" },
      { item: "Network Switch", qty: 1, status: "Need Quote", requestSpeed: "Standard" },
      { item: "Power Junction Box", qty: 1, status: "Need Quote", requestSpeed: "Standard" },
    ],
  },
];

function money(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function projectCompletion(project: ProjectSite) {
  if (project.bom.length === 0) {
    return 0;
  }
  const done = project.bom.filter((line) => line.status === "Completed" || line.status === "Delivered to Office" || line.status === "Delivered to Client" || line.status === "From Inventory").length;
  return Math.round((done / project.bom.length) * 100);
}

function moneyExact(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function lineTotal(line: PurchaseOrderLine) {
  return line.lineTotal ?? line.qty * line.unitCost;
}

function formatPoDate(isoDate: string) {
  if (!isoDate) {
    return "";
  }
  const parsed = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? isoDate : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function sumBy<T extends string>(items: PurchaseOrder[], key: (order: PurchaseOrder) => T) {
  return items.reduce<Record<T, number>>((totals, order) => {
    const bucket = key(order);
    totals[bucket] = (totals[bucket] ?? 0) + order.total;
    return totals;
  }, {} as Record<T, number>);
}

function nextSkuRef(items: Part[]) {
  const maxRef = items.reduce((currentMax, item) => {
    const match = item.ref.match(/^SKU-(\d+)$/);
    return match ? Math.max(currentMax, Number(match[1])) : currentMax;
  }, 0);

  return `SKU-${String(maxRef + 1).padStart(4, "0")}`;
}

function nextBuildRef(items: Part[]) {
  const maxRef = items.reduce((currentMax, item) => {
    const match = item.ref.match(/^BLD-(\d+)$/);
    return match ? Math.max(currentMax, Number(match[1])) : currentMax;
  }, 0);

  return `BLD-${String(maxRef + 1).padStart(4, "0")}`;
}

function projectSlug(projectName: string) {
  return projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function viewFromHash(hash = window.location.hash): View {
  const viewKey = hash.replace(/^#/, "").split("/")[0];
  return ["dashboard", "purchasing", "inventory", "projects", "sales", "tasks", "reports", "saas_calendar", "admin", "library"].includes(viewKey) ? (viewKey as View) : "dashboard";
}

function savedView() {
  const savedHash = window.localStorage.getItem("ergon:lastHash");
  return savedHash ? viewFromHash(savedHash) : "dashboard";
}

function scrollKey(hash = window.location.hash) {
  return `ergon:scroll:${hash || "#dashboard"}`;
}

// Remembers a collapsible panel's open/closed state across refreshes (e.g.
// Product Catalog, Site Builder) -- same "ergon:" localStorage convention as
// the scroll-position/last-hash restore above. Falls back to defaultValue
// when nothing's saved yet or storage isn't available.
function usePersistedCollapse(storageKey: string, defaultValue = false) {
  const key = `ergon:collapsed:${storageKey}`;
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return saved === null ? defaultValue : saved === "1";
    } catch {
      return defaultValue;
    }
  });

  function setCollapsed(value: boolean | ((current: boolean) => boolean)) {
    setCollapsedState((current) => {
      const next = typeof value === "function" ? (value as (current: boolean) => boolean)(current) : value;
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Storage unavailable -- state still updates for this session.
      }
      return next;
    });
  }

  return [collapsed, setCollapsed] as const;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// "Download" buttons across the app (project documents, sales quote
// photos/drawings) were all just window.open()-ing a signed URL -- since
// most images/PDFs render inline, that just shows the file in a new tab
// instead of actually saving it to disk, which is what "Download" implies.
// Fetching it as a blob first and clicking a same-origin blob: link with a
// `download` attribute forces a real save-to-disk with the right file
// name, regardless of how the file's content-type wants to render.
async function triggerBrowserDownload(url: string, fileName: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download fetch failed: ${response.status}`);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  } catch {
    // Fall back to just opening it (e.g. a CORS-blocked fetch) -- better
    // than the download silently doing nothing.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function csvValue(value: string | number | undefined | null) {
  const normalized = String(value ?? "");
  return /[",\n\r]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function exportCsv(filename: string, rows: Array<Record<string, string | number | undefined | null>>) {
  if (rows.length === 0) {
    return;
  }

  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function movementNumber(index: number) {
  return `TXN-${String(index + 1).padStart(5, "0")}`;
}

function buildNumber(index: number) {
  return `BUILD-${String(index + 1).padStart(4, "0")}`;
}

function purchaseRequestNumber(index: number) {
  return `REQ-${String(index + 1).padStart(5, "0")}`;
}

function shipmentNumber(index: number) {
  return `SHP-${String(index + 1).padStart(4, "0")}`;
}

function isArray<T>(value: unknown, fallback: T[]) {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function App() {
  const localState = loadLocalAppState();
  const [view, setView] = useState<View>(() => (window.location.hash ? viewFromHash() : savedView()));
  const [locationHash, setLocationHash] = useState(window.location.hash || window.localStorage.getItem("ergon:lastHash") || "#dashboard");
  const [projectDetailContext, setProjectDetailContext] = useState<{ name: string; ref: string } | null>(null);

  // Deliberately inert service worker (public/sw.js, no caching) -- some
  // Chrome versions require one registered for the automatic
  // beforeinstallprompt event InstallAppBanner listens for.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  // Phase 10c: Inventory Items no longer lives in the local/blob state --
  // it's always loaded fresh from the real table (see the effect below).
  const [inventoryItems, setInventoryItems] = useState<Part[]>([]);
  // Phase 10f: Projects no longer lives in the local/blob state -- it's
  // always loaded fresh from the real table (see the effect below).
  const [projectSites, setProjectSites] = useState<ProjectSite[]>([]);
  // Phase 10d: Equipment Recipes no longer lives in the local/blob state --
  // it's always loaded fresh from the real table (see the effect below).
  const [deviceRecipes, setDeviceRecipes] = useState<BuildRecipe[]>([]);
  // Phase 10e: Inventory Movements, Build Transactions, and Project
  // Allocation History no longer live in the local/blob state -- they're
  // always loaded fresh from the real tables (see the effect below).
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [buildTransactions, setBuildTransactions] = useState<BuildTransaction[]>([]);
  const [projectAllocations, setProjectAllocations] = useState<ProjectAllocationHistory[]>([]);
  // Phase 10a: Purchase Requests no longer lives in the local/blob state --
  // it's always loaded fresh from the real table (see the effect below).
  // purchaseRequestsRef mirrors this state synchronously (updated at the
  // same time as every setPurchaseRequests call below) so the dedupe logic
  // in queuePurchaseRequest sees fresh data even when several requests are
  // queued back-to-back in the same synchronous loop, ahead of React's
  // render/effect cycle.
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const purchaseRequestsRef = useRef<PurchaseRequest[]>([]);
  // Phase 10b: Project Documents no longer lives in the local/blob state --
  // it's always loaded fresh from the real table (see the effect below).
  const [projectDocuments, setProjectDocuments] = useState<UploadedDoc[]>([]);
  // Purchase Orders (migration 032): used to be a hardcoded, unchangeable
  // array of 7 historical orders. Now loaded from the real table and
  // extended by createPurchaseOrder/updatePurchaseOrderStatus below.
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [roleMode, setRoleMode] = useState<RoleMode>(() => ((localState?.roleMode as RoleMode | undefined) ?? "manager"));
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => loadAuthSession());
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authStatus, setAuthStatus] = useState("Sign in to use production cloud persistence.");
  const [passwordResetSession, setPasswordResetSession] = useState<AuthSession | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (isRemotePersistenceConfigured() ? "loading" : "local"));
  const [isAdmin, setIsAdmin] = useState(false);
  const [knownUsers, setKnownUsers] = useState<KnownUser[]>([]);
  const [userRoleMap, setUserRoleMap] = useState<Record<string, UserRoles>>({});
  const [ownRoleKeys, setOwnRoleKeys] = useState<string[]>([]);
  const [adminIds, setAdminIds] = useState<string[]>([]);
  const [branding, setBranding] = useState<CompanyBranding>({ companyName: "Ergon", logoStoragePath: "" });
  const [brandingStatus, setBrandingStatus] = useState("");
  const [invites, setInvites] = useState<UserInvite[]>([]);
  const [inviteStatus, setInviteStatus] = useState("");
  const [adminStatus, setAdminStatus] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogPriceChangeRequests, setCatalogPriceChangeRequests] = useState<CatalogPriceChangeRequest[]>([]);
  const [catalogPriceChangeStatus, setCatalogPriceChangeStatus] = useState("");
  const [catalogStatus, setCatalogStatus] = useState("");
  const [salesQuotes, setSalesQuotes] = useState<SalesQuote[]>([]);
  const [salesQuoteStatus, setSalesQuoteStatus] = useState("");
  const [authChecksReady, setAuthChecksReady] = useState(false);
  const [userApprovalStatus, setUserApprovalStatus] = useState<UserStatus | null>(null);
  const [ownAllowedViews, setOwnAllowedViews] = useState<string[] | null>(null);
  const [approvalStatuses, setApprovalStatuses] = useState<UserStatus[]>([]);
  const [allowedViewsMap, setAllowedViewsMap] = useState<Record<string, string[] | null>>({});
  const [approvalReviewStatus, setApprovalReviewStatus] = useState("");
  const [tasks, setTasks] = useState<EOTask[]>([]);
  const [deletedTasks, setDeletedTasks] = useState<EOTask[]>([]);
  const [taskStatusMessage, setTaskStatusMessage] = useState("");
  const [taskActivity, setTaskActivity] = useState<TaskActivityEntry[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMemberStatus, setTeamMemberStatus] = useState("");
  const [pendingPhotoCount, setPendingPhotoCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationRules, setNotificationRules] = useState<NotificationRule[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [inventorySearchFocus, setInventorySearchFocus] = useState<{ term: string; token: number } | null>(null);
  const [reportsSearchFocus, setReportsSearchFocus] = useState<{ term: string; token: number } | null>(null);
  const [purchasingSearchFocus, setPurchasingSearchFocus] = useState<{ term: string; token: number } | null>(null);
  const [taskFocus, setTaskFocus] = useState<{ taskId: string; token: number } | null>(null);
  const [standardInstallTimes, setStandardInstallTimes] = useState<StandardInstallTime[]>([]);
  const [scheduleTemplates, setScheduleTemplates] = useState<ScheduleTemplate[]>([]);
  const [scheduleStatus, setScheduleStatus] = useState("");
  const [submittals, setSubmittals] = useState<ProjectSubmittal[]>([]);
  const [submittalStatus, setSubmittalStatus] = useState("");
  const [proposalTemplateSections, setProposalTemplateSections] = useState<ProposalTemplateSection[]>([]);
  const [quoteProposals, setQuoteProposals] = useState<SalesQuoteProposal[]>([]);
  const [quoteProposalStatus, setQuoteProposalStatus] = useState("");
  const [handoverSchema, setHandoverSchema] = useState<FormSchema | null>(null);
  const [formBuilderStatus, setFormBuilderStatus] = useState("");
  const [handovers, setHandovers] = useState<ProjectHandover[]>([]);
  const [handoverStatus, setHandoverStatus] = useState("");
  const [siteIntakeSchema, setSiteIntakeSchema] = useState<FormSchema | null>(null);
  const [siteIntakeFormBuilderStatus, setSiteIntakeFormBuilderStatus] = useState("");
  const [quoteIntakeResponses, setQuoteIntakeResponses] = useState<Record<string, SalesQuoteIntakeResponse>>({});
  const [quoteIntakeStatus, setQuoteIntakeStatus] = useState("");
  const [presalesRules, setPresalesRules] = useState<PresalesHardwareRule[]>([]);
  const [siteHardwareRules, setSiteHardwareRules] = useState<SiteHardwareRule[]>([]);
  const [siteHardwareRuleStatus, setSiteHardwareRuleStatus] = useState("");
  const [presalesStatus, setPresalesStatus] = useState("");
  const [taskHardwareDependencies, setTaskHardwareDependencies] = useState<TaskHardwareDependency[]>([]);
  const [inventoryItemSkuById, setInventoryItemSkuById] = useState<Record<string, string>>({});
  const lowStock = inventoryItems.filter((part) => !part.retired && part.stock <= part.reorderPoint);
  const inventoryValue = inventoryItems.reduce((sum, part) => sum + part.stock * part.cost, 0);
  const openPoValue = purchaseOrders.reduce((sum, po) => sum + po.total, 0);

  useEffect(() => {
    if (!isRemotePersistenceConfigured()) {
      return;
    }
    let cancelled = false;
    consumeOAuthRedirectSession()
      .then(async (session) => {
        if (session && !cancelled) {
          if (session.authFlow === "recovery") {
            setPasswordResetSession(session);
            setAuthSession(null);
            setAuthStatus("Enter a new password to finish the reset.");
            setSyncStatus("auth");
            return;
          }
          // If this Google sign-in was reached from the invite landing page
          // (see InviteLandingPage's "Continue with Google" button, which
          // stashes the token before the redirect), finish accepting the
          // invite now that we have a real session -- assigns the roles the
          // admin picked and auto-approves the account.
          const pendingInviteToken = window.sessionStorage.getItem("pendingInviteToken");
          let inviteFailure: string | null = null;
          if (pendingInviteToken) {
            window.sessionStorage.removeItem("pendingInviteToken");
            try {
              await acceptInvite(pendingInviteToken, session.accessToken);
            } catch (error) {
              // Don't swallow this silently -- if the invite failed to apply
              // (already used, expired, etc.) the user is now signed in as a
              // brand-new account with no role and no approval, and will land
              // on the generic "Waiting for approval" screen with no
              // indication this was supposed to be an invite acceptance.
              inviteFailure = error instanceof Error ? error.message : "Could not finish accepting your invite.";
            }
          }
          setAuthSession(session);
          setAuthStatus(
            inviteFailure
              ? `Signed in as ${session.email}, but your invite could not be applied: ${inviteFailure}. Ask an admin to resend the invite or approve your account.`
              : `Signed in as ${session.email}.`
          );
          setSyncStatus(inviteFailure ? "error" : "loading");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAuthStatus(error instanceof Error ? error.message : "Google sign-in failed.");
          setSyncStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isRemotePersistenceConfigured()) {
      setSyncStatus("local");
      return () => {
        cancelled = true;
      };
    }

    if (!authSession) {
      setSyncStatus("auth");
      return () => {
        cancelled = true;
      };
    }

    setSyncStatus("loading");
    const sessionPromise = authSession.expiresAt < Date.now() + 60_000 ? refreshAuthSession(authSession) : Promise.resolve(authSession);
    sessionPromise
      .then((session) => {
        if (cancelled) {
          return null;
        }
        setAuthSession(session);
        return loadRemoteAppState(session.accessToken);
      })
      .then((remoteState) => {
        if (!remoteState || cancelled) {
          if (!cancelled) {
            setSyncStatus("synced");
          }
          return;
        }
        setRoleMode((remoteState.roleMode as RoleMode | undefined) ?? "manager");
        setSyncStatus("synced");
      })
      .catch(() => {
        // Local persistence remains active when Supabase is not configured yet.
        setSyncStatus("error");
        setAuthStatus("Cloud load failed. Sign in again or check Supabase settings.");
      });
    return () => {
      cancelled = true;
    };
  }, [authSession]);

  useEffect(() => {
    const state: PersistedAppState = {
      roleMode,
    };
    saveLocalAppState(state);
    if (!isRemotePersistenceConfigured()) {
      setSyncStatus("local");
      return;
    }
    if (!authSession) {
      setSyncStatus("auth");
      return;
    }
    setSyncStatus("saving");
    const syncTimer = window.setTimeout(() => {
      saveRemoteAppState(state, authSession.accessToken)
        .then(() => setSyncStatus("synced"))
        .catch(() => {
          // Keep the UI usable offline or before Supabase keys are installed.
          setSyncStatus("error");
          setAuthStatus("Cloud save failed. Check login, RLS policies, or Supabase env vars.");
        });
    }, 650);
    return () => window.clearTimeout(syncTimer);
  }, [roleMode, authSession]);

  // Phase 10f: Projects (plus Scope of Work and BOM lines) now live in their
  // own real tables, loaded once per session and then debounce-saved as a
  // whole array on every change -- the same shape the blob used, so none of
  // the add-project/edit-SOW/edit-BOM-line logic in the Projects component
  // needed to change, only where it's persisted.
  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      return;
    }
    loadProjectSites(authSession.accessToken).then(setProjectSites).catch(() => {});
  }, [authSession]);

  // Uploads Site Builder photos that got stuck in the offline queue (see
  // flushPendingSitePhotos above) as soon as there's a real chance they'll
  // succeed: once on login/reload, immediately when the browser fires
  // `online`, and on a standing interval in case `online` never fires (some
  // mobile browsers don't dispatch it reliably on a signal come-back).
  useEffect(() => {
    if (!authSession) {
      return;
    }
    flushPendingSitePhotos();
    const onOnline = () => flushPendingSitePhotos();
    window.addEventListener("online", onOnline);
    const interval = window.setInterval(flushPendingSitePhotos, 45000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(interval);
    };
  }, [authSession]);

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured() || projectSites.length === 0) {
      return;
    }
    const syncTimer = window.setTimeout(() => {
      saveProjectSites(projectSites, authSession.accessToken).catch(() => {
        setSyncStatus("error");
        setAuthStatus("Cloud save failed for projects. Check login, RLS policies, or Supabase env vars.");
      });
    }, 650);
    return () => window.clearTimeout(syncTimer);
  }, [projectSites, authSession]);

  // Phase 10e: Inventory Movements, Build Transactions, and Project
  // Allocation History now live in their own real tables, loaded once per
  // session and then debounce-saved as whole arrays on every change -- the
  // same shape the blob used, so none of the pull/receive/transfer/
  // build/undo/retire append logic elsewhere in this file needed to change,
  // only where it's persisted. Movements depend on knowing build ids
  // (resolved by build_number) and allocations depend on knowing movement
  // ids (resolved by legacy_id), so saveMovementsBuildsAllocations always
  // saves builds, then movements, then allocations, in that order.
  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      return;
    }
    loadBuildTransactions(authSession.accessToken).then(setBuildTransactions).catch(() => {});
    loadInventoryMovements(authSession.accessToken).then(setInventoryMovements).catch(() => {});
    loadProjectAllocations(authSession.accessToken).then(setProjectAllocations).catch(() => {});
  }, [authSession]);

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      return;
    }
    if (buildTransactions.length === 0 && inventoryMovements.length === 0 && projectAllocations.length === 0) {
      return;
    }
    const syncTimer = window.setTimeout(() => {
      saveMovementsBuildsAllocations(buildTransactions, inventoryMovements, projectAllocations, authSession.accessToken).catch(() => {
        setSyncStatus("error");
        setAuthStatus("Cloud save failed for movements/builds/allocations. Check login, RLS policies, or Supabase env vars.");
      });
    }, 650);
    return () => window.clearTimeout(syncTimer);
  }, [buildTransactions, inventoryMovements, projectAllocations, authSession]);

  // Phase 10d: Equipment Recipes now lives in its own real tables
  // (equipment_types + equipment_bom_components), loaded once per session and
  // then debounce-saved as a whole array on every change -- the same shape
  // the blob used, so none of the add/edit/retire-recipe logic in the
  // Inventory component below needed to change, only where it's persisted.
  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      return;
    }
    loadDeviceRecipes(authSession.accessToken).then(setDeviceRecipes).catch(() => {});
  }, [authSession]);

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured() || deviceRecipes.length === 0) {
      return;
    }
    const syncTimer = window.setTimeout(() => {
      saveDeviceRecipes(deviceRecipes, authSession.accessToken).catch(() => {
        setSyncStatus("error");
        setAuthStatus("Cloud save failed for equipment recipes. Check login, RLS policies, or Supabase env vars.");
      });
    }, 650);
    return () => window.clearTimeout(syncTimer);
  }, [deviceRecipes, authSession]);

  // Phase 10c: Inventory Items now lives in its own real tables
  // (inventory_items + inventory_balances), loaded once per session and then
  // debounce-saved as a whole array on every change -- the same shape the
  // blob used, so none of the pull/receive/transfer/build/adjust logic below
  // needed to change, only where it's persisted.
  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      return;
    }
    loadInventoryItems(authSession.accessToken).then(setInventoryItems).catch(() => {});
  }, [authSession]);

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured() || inventoryItems.length === 0) {
      return;
    }
    const syncTimer = window.setTimeout(() => {
      saveInventoryItems(inventoryItems, authSession.accessToken).catch(() => {
        setSyncStatus("error");
        setAuthStatus("Cloud save failed for inventory items. Check login, RLS policies, or Supabase env vars.");
      });
    }, 650);
    return () => window.clearTimeout(syncTimer);
  }, [inventoryItems, authSession]);

  // Phase 10a: Purchase Requests now lives in its own real table, loaded and
  // saved independently of the blob-based state above.
  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      return;
    }
    loadPurchaseRequests(authSession.accessToken)
      .then((loaded) => {
        purchaseRequestsRef.current = loaded;
        setPurchaseRequests(loaded);
      })
      .catch(() => {});
  }, [authSession]);

  // Phase 10b: Project Documents now lives in its own real table, loaded and
  // saved independently of the blob-based state above.
  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      return;
    }
    loadProjectDocuments(authSession.accessToken).then(setProjectDocuments).catch(() => {});
  }, [authSession]);

  // Purchase Orders (migration 032): loaded fresh from the real table, same
  // per-row create/update pattern as Purchase Requests and Project
  // Documents above.
  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      return;
    }
    loadPurchaseOrders(authSession.accessToken).then(setPurchaseOrders).catch(() => {});
  }, [authSession]);

  async function handleCreatePurchaseOrder(order: Parameters<typeof createPurchaseOrder>[0]) {
    if (!authSession) {
      setAuthStatus("Sign in to create a purchase order.");
      return;
    }
    try {
      const created = await createPurchaseOrder(order, authSession.accessToken);
      if (created) {
        setPurchaseOrders((current) => [created, ...current]);
      }
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Could not save the purchase order.");
    }
  }

  async function handleUpdatePurchaseOrderStatus(id: string, status: PurchaseOrder["status"]) {
    setPurchaseOrders((current) => current.map((order) => (order.id === id ? { ...order, status } : order)));
    if (authSession) {
      await updatePurchaseOrderStatus(id, status, authSession.accessToken);
    }
  }

  // Each entry can carry the actual File that was picked -- if it does, the
  // bytes get uploaded to the private "project-documents" Storage bucket
  // before the row is created, so the document record actually points at a
  // retrievable file instead of only a name and size.
  async function handleCreateProjectDocuments(entries: Array<{ doc: Omit<UploadedDoc, "id">; file?: File }>) {
    if (!authSession) {
      return;
    }
    try {
      const docs = await Promise.all(
        entries.map(async ({ doc, file }) => {
          const stampedDoc = { ...doc, uploadedByEmail: doc.uploadedByEmail ?? authSession.email };
          if (!file) {
            return stampedDoc;
          }
          const storagePath = buildDocumentStoragePath(doc.project, doc.name);
          const uploaded = await uploadDocumentFile(file, storagePath, authSession.accessToken);
          return uploaded ? { ...stampedDoc, storage: "Supabase Storage" as const, storagePath } : stampedDoc;
        }),
      );
      const created = await createProjectDocuments(docs, authSession.accessToken);
      setProjectDocuments((current) => [...created, ...current]);
    } catch (error) {
      setSyncStatus("error");
    }
  }

  async function handleDownloadDocument(doc: UploadedDoc) {
    if (!authSession || !doc.storagePath) {
      setAuthStatus("This document doesn't have a stored file to download (it may predate real file storage).");
      return;
    }
    const url = await getDocumentDownloadUrl(doc.storagePath, authSession.accessToken);
    if (!url) {
      setAuthStatus("Could not generate a download link for this file.");
      return;
    }
    await triggerBrowserDownload(url, doc.name || "document");
  }

  async function handleUpdateProjectDocumentStatus(id: UploadedDoc["id"], status: UploadedDoc["status"]) {
    setProjectDocuments((current) => current.map((doc) => (doc.id === id ? { ...doc, status } : doc)));
    if (authSession) {
      await updateProjectDocumentStatusRemote(id, status, authSession.accessToken);
    }
  }

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured() || !isAdmin) {
      return;
    }

    void saveUserRoleMode(authSession.userId, roleMode, authSession.accessToken);
  }, [authSession, roleMode, isAdmin]);

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      return;
    }
    loadCompanyBranding(authSession.accessToken).then(setBranding).catch(() => undefined);
  }, [authSession]);

  async function handleSaveCompanyName(name: string) {
    if (!authSession) {
      return;
    }
    try {
      await saveCompanyBranding({ companyName: name }, authSession.accessToken);
      setBranding((current) => ({ ...current, companyName: name }));
      setBrandingStatus("Company name updated.");
    } catch (error) {
      setBrandingStatus(error instanceof Error ? error.message : "Could not update company name.");
    }
  }

  async function handleUploadCompanyLogo(file: File) {
    if (!authSession) {
      return;
    }
    const path = await uploadCompanyLogo(file, authSession.accessToken);
    if (!path) {
      setBrandingStatus("Could not upload logo.");
      return;
    }
    try {
      await saveCompanyBranding({ logoStoragePath: path }, authSession.accessToken);
      setBranding((current) => ({ ...current, logoStoragePath: path }));
      setBrandingStatus("Logo updated.");
    } catch (error) {
      setBrandingStatus(error instanceof Error ? error.message : "Could not save logo.");
    }
  }

  function reloadAdminDirectory(accessToken: string) {
    Promise.all([loadAllKnownUsers(accessToken), loadAllUserRoles(accessToken), loadAllAdmins(accessToken), loadAllAllowedViews(accessToken)])
      .then(([users, roles, admins, allowedViews]) => {
        setKnownUsers(users);
        setUserRoleMap(roles);
        setAdminIds(admins);
        setAllowedViewsMap(allowedViews);
      })
      .catch(() => setAdminStatus("Could not load the user directory."));
    loadInvites(accessToken)
      .then(setInvites)
      .catch(() => setInviteStatus("Could not load invites."));
  }

  function reloadApprovalQueue(accessToken: string) {
    loadAllApprovalStatuses(accessToken)
      .then(setApprovalStatuses)
      .catch(() => setApprovalReviewStatus("Could not load pending approvals."));
  }

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setIsAdmin(false);
      setAuthChecksReady(false);
      setUserApprovalStatus(null);
      setOwnAllowedViews(null);
      return;
    }

    let cancelled = false;
    setAuthChecksReady(false);
    void upsertKnownUser(authSession.userId, authSession.email, authSession.accessToken);

    Promise.all([
      checkIsAdmin(authSession.userId, authSession.accessToken),
      loadUserRoleMode(authSession.userId, authSession.accessToken),
      loadOwnRoleKeys(authSession.userId, authSession.accessToken),
      loadOwnAllowedViews(authSession.userId, authSession.accessToken),
      ensureOwnApprovalRequest(authSession.userId, authSession.accessToken).then((isNewSignup) => {
        if (isNewSignup) {
          // Brand-new pending sign-up -- previously nothing surfaced this
          // except an admin happening to check Admin -> Pending Approvals.
          // Fire-and-forget: notify every admin so it shows up as an alert.
          loadAdminEmails(authSession.accessToken)
            .then((admins) => {
              admins.forEach((admin) => {
                notify(
                  "user_signup_pending",
                  admin.email,
                  "New sign-up needs approval",
                  `${authSession.email ?? "A new user"} just signed up and is waiting for approval in Admin -> Pending Approvals.`,
                  "app_user_status",
                  authSession.userId,
                  `user_signup_pending:${authSession.userId}`,
                );
              });
            })
            .catch(() => undefined);
        }
        return loadOwnApprovalStatus(authSession.userId, authSession.accessToken);
      }),
    ]).then(([adminFlag, savedRole, roleKeys, allowedViews, status]) => {
      if (cancelled) {
        return;
      }
      setIsAdmin(adminFlag);
      const resolvedRole = savedRole && (ALL_ROLE_KEYS as string[]).includes(savedRole) ? (savedRole as RoleMode) : null;
      if (resolvedRole) {
        setRoleMode(resolvedRole);
      }
      setOwnRoleKeys(roleKeys);
      setOwnAllowedViews(allowedViews);
      setUserApprovalStatus(status);
      setAuthChecksReady(true);
      if (adminFlag) {
        reloadAdminDirectory(authSession.accessToken);
      }
      if (adminFlag || resolvedRole === "manager") {
        reloadApprovalQueue(authSession.accessToken);
      }
      // Every signed-in user gets a shot at ensuring their own roster row
      // exists (migration 035 lets anyone write only their own row by
      // email) -- not just Admins/Managers, so everyone shows up in their
      // own Assignee dropdown even if RLS still blocks them from touching
      // anyone else's roster entry.
      const guessedName = authSession.email
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
      ensureTeamMemberForSelf(authSession.email, guessedName, authSession.accessToken).then(() =>
        reloadTeamMembers(authSession.accessToken),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [authSession]);

  async function handleReviewApproval(targetUserId: string, status: ApprovalStatus, expiresAt: string | null) {
    if (!authSession) {
      return;
    }
    try {
      await reviewUserApproval(targetUserId, status, authSession.userId, expiresAt, authSession.accessToken);
      setApprovalStatuses((current) => {
        const existing = current.find((entry) => entry.userId === targetUserId);
        const updated: UserStatus = {
          userId: targetUserId,
          approvalStatus: status,
          expiresAt,
          approvedBy: authSession.userId,
          approvedAt: new Date().toISOString(),
          requestedAt: existing?.requestedAt ?? new Date().toISOString(),
          hasSeenWelcome: existing?.hasSeenWelcome ?? false,
        };
        return existing ? current.map((entry) => (entry.userId === targetUserId ? updated : entry)) : [...current, updated];
      });
      setApprovalReviewStatus("Updated.");
    } catch (error) {
      setApprovalReviewStatus(error instanceof Error ? error.message : "Could not update approval.");
    }
  }

  async function handleSetAllowedViews(userId: string, views: string[] | null) {
    if (!authSession) {
      return;
    }
    try {
      await setUserAllowedViews(userId, views, authSession.accessToken);
      setAllowedViewsMap((current) => ({ ...current, [userId]: views }));
      setAdminStatus("Tab access updated.");
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : "Could not update tab access.");
    }
  }

  async function handleSetUserRole(userId: string, roleKey: string) {
    if (!authSession) {
      return;
    }
    try {
      await setPrimaryUserRole(userId, roleKey, authSession.accessToken);
      setUserRoleMap((current) => {
        const existing = current[userId] ?? { primary: "", secondary: [] };
        // Promoting a role that was already held as secondary removes it
        // from the secondary set locally too, matching what the server
        // just did (see setPrimaryUserRole's merge-duplicates upsert).
        return { ...current, [userId]: { primary: roleKey, secondary: existing.secondary.filter((key) => key !== roleKey) } };
      });
      setAdminStatus("Role updated.");
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : "Could not update role.");
    }
  }

  async function handleSetSecondaryRoles(userId: string, roleKeys: string[]) {
    if (!authSession) {
      return;
    }
    try {
      await setSecondaryUserRoles(userId, roleKeys, authSession.accessToken);
      setUserRoleMap((current) => {
        const existing = current[userId] ?? { primary: "", secondary: [] };
        return { ...current, [userId]: { ...existing, secondary: roleKeys } };
      });
      setAdminStatus("Roles updated.");
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : "Could not update secondary roles.");
    }
  }

  async function handleSendInvite(input: { email: string; fullName: string; primaryRole: string; secondaryRoles: string[] }) {
    if (!authSession) {
      return;
    }
    const email = input.email.trim();
    if (!email || !input.primaryRole) {
      setInviteStatus("Email and primary role are required to send an invite.");
      return;
    }
    setInviteStatus("Sending invite...");
    try {
      const invite = await createInvite(
        { email, fullName: input.fullName, primaryRole: input.primaryRole, secondaryRoles: input.secondaryRoles, invitedByEmail: authSession.email },
        authSession.accessToken,
      );
      if (!invite) {
        setInviteStatus("Could not create the invite.");
        return;
      }
      setInvites((current) => [invite, ...current]);
      await sendInviteEmail(invite);
    } catch (error) {
      setInviteStatus(error instanceof Error ? error.message : "Could not create the invite.");
    }
  }

  async function sendInviteEmail(invite: UserInvite) {
    const roleLabel = ROLE_KEY_OPTIONS.find((option) => option.value === invite.primaryRole)?.label ?? invite.primaryRole;
    const inviteUrl = `${window.location.origin}/?invite=${invite.token}`;
    try {
      const response = await fetch("/api/send-invite-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: invite.email, fullName: invite.fullName, roleLabel, inviteUrl, companyName: branding.companyName }),
      });
      const result = (await response.json()) as { sent: boolean; reason?: string; error?: string };
      setInviteStatus(result.sent ? `Invite emailed to ${invite.email}.` : (result.reason || result.error || "Invite created, but the email could not be sent."));
    } catch {
      setInviteStatus(`Invite created for ${invite.email}, but the email could not be sent -- copy the link instead.`);
    }
  }

  async function handleResendInvite(invite: UserInvite) {
    setInviteStatus("Resending invite...");
    await sendInviteEmail(invite);
  }

  async function handleRevokeInvite(id: string) {
    if (!authSession) {
      return;
    }
    try {
      await revokeInvite(id, authSession.accessToken);
      setInvites((current) => current.map((invite) => (invite.id === id ? { ...invite, status: "revoked" } : invite)));
      setInviteStatus("Invite revoked.");
    } catch (error) {
      setInviteStatus(error instanceof Error ? error.message : "Could not revoke the invite.");
    }
  }

  async function handleGrantAdmin(userId: string) {
    if (!authSession) {
      return;
    }
    try {
      await grantAdmin(userId, authSession.accessToken);
      setAdminIds((current) => (current.includes(userId) ? current : [...current, userId]));
      setAdminStatus("Admin access granted.");
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : "Could not grant admin access.");
    }
  }

  async function handleRevokeAdmin(userId: string) {
    if (!authSession) {
      return;
    }
    if (userId === authSession.userId) {
      setAdminStatus("You cannot remove your own admin access from this screen.");
      return;
    }
    try {
      await revokeAdmin(userId, authSession.accessToken);
      setAdminIds((current) => current.filter((id) => id !== userId));
      setAdminStatus("Admin access removed.");
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : "Could not remove admin access.");
    }
  }

  function reloadCatalog(accessToken: string) {
    loadCatalogItems(accessToken)
      .then(setCatalogItems)
      .catch(() => setCatalogStatus("Could not load the product catalog."));
  }

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setCatalogItems([]);
      return;
    }
    reloadCatalog(authSession.accessToken);
  }, [authSession]);

  async function handleCreateCatalogItem(item: Omit<CatalogItem, "id" | "catalogNumber">) {
    if (!authSession) {
      return;
    }
    try {
      const created = await createCatalogItem({ ...item, catalogNumber: makeCatalogNumber() }, authSession.accessToken);
      setCatalogItems((current) => [...current, created].sort((a, b) => a.productName.localeCompare(b.productName)));
      setCatalogStatus(`${created.productName} added to the catalog.`);
    } catch (error) {
      setCatalogStatus(error instanceof Error ? error.message : "Could not add catalog item.");
    }
  }

  async function handleUpdateCatalogItem(id: string, item: Omit<CatalogItem, "id">) {
    if (!authSession) {
      return;
    }
    try {
      const updated = await updateCatalogItem(id, item, authSession.accessToken);
      setCatalogItems((current) => current.map((existing) => (existing.id === id ? updated : existing)).sort((a, b) => a.productName.localeCompare(b.productName)));
      setCatalogStatus(`${updated.productName} updated.`);
    } catch (error) {
      setCatalogStatus(error instanceof Error ? error.message : "Could not update catalog item.");
    }
  }

  // Uploads a datasheet PDF to the catalog-datasheets Storage bucket
  // (migration 052) and records its path on the catalog item. Only works
  // for an already-saved item (needs its real catalogNumber for the
  // storage path and its id to PATCH) -- the Add/Edit modal only shows
  // this control once editingId is set.
  async function handleUploadCatalogDatasheet(catalogItemId: string, file: File): Promise<string | null> {
    if (!authSession) {
      return null;
    }
    const item = catalogItems.find((entry) => entry.id === catalogItemId);
    if (!item) {
      return null;
    }
    const storagePath = buildCatalogDatasheetStoragePath(item.catalogNumber, file.name);
    const uploaded = await uploadCatalogDatasheetFile(file, storagePath, authSession.accessToken);
    if (!uploaded) {
      setCatalogStatus("Could not upload that datasheet.");
      return null;
    }
    await handleUpdateCatalogItem(catalogItemId, { ...item, datasheetStoragePath: storagePath });
    return storagePath;
  }

  async function handleSetCatalogItemRetired(id: string, retired: boolean) {
    if (!authSession) {
      return;
    }
    await setCatalogItemRetired(id, retired, authSession.accessToken);
    setCatalogItems((current) => current.map((item) => (item.id === id ? { ...item, isRetired: retired } : item)));
  }

  async function handleBulkCreateCatalogItems(items: Array<Omit<CatalogItem, "id" | "catalogNumber">>): Promise<number> {
    if (!authSession || items.length === 0) {
      return 0;
    }
    const created = await bulkCreateCatalogItems(items, authSession.accessToken);
    setCatalogItems((current) => [...current, ...created].sort((a, b) => a.productName.localeCompare(b.productName)));
    setCatalogStatus(`Imported ${created.length} catalog item(s).`);
    return created.length;
  }

  // Price-change approval workflow (migration 046). product_catalog writes
  // are admin/manager-only, so a Sales rep proposing a cost/markup/price
  // change can't PATCH the catalog directly -- they insert a request row
  // instead, every manager gets notified, and approving it is a normal
  // catalog write performed by the reviewer's own already-authorized access.
  function reloadCatalogPriceChangeRequests(accessToken: string) {
    loadCatalogPriceChangeRequests(accessToken)
      .then(setCatalogPriceChangeRequests)
      .catch(() => setCatalogPriceChangeStatus("Could not load price change requests."));
  }

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setCatalogPriceChangeRequests([]);
      return;
    }
    reloadCatalogPriceChangeRequests(authSession.accessToken);
  }, [authSession]);

  async function handleProposeCatalogPriceChange(
    catalogItemId: string,
    fieldChanged: CatalogPriceChangeField,
    previousValue: number,
    requestedValue: number,
    reason: string,
  ) {
    if (!authSession) {
      return;
    }
    try {
      const created = await createCatalogPriceChangeRequest(
        { catalogItemId, requestedByEmail: authSession.email ?? "", fieldChanged, previousValue, requestedValue, reason },
        authSession.accessToken,
      );
      if (created) {
        setCatalogPriceChangeRequests((current) => [created, ...current]);
      }
      setCatalogPriceChangeStatus("Price change submitted for manager approval.");
      const item = catalogItems.find((entry) => entry.id === catalogItemId);
      const members = await loadUsersByRole("manager", authSession.accessToken).catch(() => []);
      for (const member of members) {
        await notify(
          "catalog_price_change_requested",
          member.email,
          "Catalog price change needs approval",
          `${authSession.email} proposed changing ${fieldChanged.replace(/_/g, " ")} on "${item?.productName ?? "a catalog item"}" from ${previousValue} to ${requestedValue}.${reason ? ` Reason: ${reason}` : ""}`,
          "catalog_price_change_request",
          created?.id ?? catalogItemId,
        );
      }
    } catch (error) {
      setCatalogPriceChangeStatus(error instanceof Error ? error.message : "Could not submit price change request.");
    }
  }

  async function handleApproveCatalogPriceChange(request: CatalogPriceChangeRequest) {
    if (!authSession) {
      return;
    }
    try {
      await approveCatalogPriceChangeRequest(request, authSession.email ?? "", authSession.accessToken);
      setCatalogPriceChangeRequests((current) =>
        current.map((entry) => (entry.id === request.id ? { ...entry, status: "approved", reviewedByEmail: authSession.email ?? "", reviewedAt: new Date().toISOString() } : entry)),
      );
      setCatalogItems((current) =>
        current.map((item) => {
          if (item.id !== request.catalogItemId) {
            return item;
          }
          if (request.fieldChanged === "unit_cost") {
            return { ...item, unitCost: request.requestedValue };
          }
          if (request.fieldChanged === "markup_percent") {
            return { ...item, markupPercent: request.requestedValue };
          }
          return { ...item, defaultSellPrice: request.requestedValue };
        }),
      );
      setCatalogPriceChangeStatus("Price change approved and applied to the catalog.");
      await notify(
        "catalog_price_change_reviewed",
        request.requestedByEmail,
        "Your catalog price change was approved",
        `${authSession.email} approved your request to change ${request.fieldChanged.replace(/_/g, " ")} to ${request.requestedValue}.`,
        "catalog_price_change_request",
        request.id,
      );
    } catch (error) {
      setCatalogPriceChangeStatus(error instanceof Error ? error.message : "Could not approve that price change.");
    }
  }

  async function handleRejectCatalogPriceChange(request: CatalogPriceChangeRequest) {
    if (!authSession) {
      return;
    }
    try {
      await rejectCatalogPriceChangeRequest(request.id, authSession.email ?? "", authSession.accessToken);
      setCatalogPriceChangeRequests((current) =>
        current.map((entry) => (entry.id === request.id ? { ...entry, status: "rejected", reviewedByEmail: authSession.email ?? "", reviewedAt: new Date().toISOString() } : entry)),
      );
      setCatalogPriceChangeStatus("Price change rejected.");
      await notify(
        "catalog_price_change_reviewed",
        request.requestedByEmail,
        "Your catalog price change was rejected",
        `${authSession.email} rejected your request to change ${request.fieldChanged.replace(/_/g, " ")} to ${request.requestedValue}.`,
        "catalog_price_change_request",
        request.id,
      );
    } catch (error) {
      setCatalogPriceChangeStatus(error instanceof Error ? error.message : "Could not reject that price change.");
    }
  }

  // Sales Quote Builder (migration 033). Loaded once per session, same
  // per-row create/update pattern as Purchase Orders/Requests.
  function reloadSalesQuotes(accessToken: string) {
    loadSalesQuotes(accessToken)
      .then((quotes) => {
        setSalesQuotes(quotes);
        setSalesQuoteStatus("");
      })
      .catch((error) => {
        // Deliberately NOT clearing salesQuotes here -- a failed reload
        // should never blank out quotes that are already showing on
        // screen (that's what made a stale-columns query look like
        // deleted data). Keep whatever was last successfully loaded and
        // surface the real error instead.
        setSalesQuoteStatus(error instanceof Error ? error.message : "Could not load sales quotes.");
      });
  }

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setSalesQuotes([]);
      return;
    }
    reloadSalesQuotes(authSession.accessToken);
  }, [authSession]);

  async function handleCreateSalesQuote(input: NewSiteInput) {
    if (!authSession) {
      setSalesQuoteStatus("Sign in to create a quote.");
      return;
    }
    try {
      const created = await createSalesQuote({ ...input, createdByEmail: authSession.email }, authSession.accessToken);
      if (created) {
        setSalesQuotes((current) => [created, ...current]);
        setSalesQuoteStatus(`Quote for ${created.siteName} created with ${created.locations.length} location${created.locations.length === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      setSalesQuoteStatus(error instanceof Error ? error.message : "Could not create the quote.");
    }
  }

  async function handleAddSalesQuoteLocation(quoteId: string, locationType: "garage" | "lot") {
    if (!authSession) {
      return;
    }
    const quote = salesQuotes.find((entry) => entry.id === quoteId);
    if (!quote) {
      return;
    }
    const nextLineSort = quote.locations.length;
    const created = await addSalesQuoteLocation(quoteId, locationType, nextLineSort, authSession.accessToken);
    if (created) {
      setSalesQuotes((current) => current.map((entry) => (entry.id === quoteId ? { ...entry, locations: [...entry.locations, created] } : entry)));
    }
  }

  async function handleUpdateSalesQuoteLocation(
    quoteId: string,
    locationId: string,
    updates: Parameters<typeof updateSalesQuoteLocation>[1],
  ) {
    setSalesQuotes((current) =>
      current.map((entry) =>
        entry.id === quoteId
          ? { ...entry, locations: entry.locations.map((location) => (location.id === locationId ? { ...location, ...updates } : location)) }
          : entry,
      ),
    );
    if (authSession) {
      await updateSalesQuoteLocation(locationId, updates, authSession.accessToken);
    }
  }

  async function handleDeleteSalesQuoteLocation(quoteId: string, locationId: string) {
    setSalesQuotes((current) =>
      current.map((entry) => (entry.id === quoteId ? { ...entry, locations: entry.locations.filter((location) => location.id !== locationId) } : entry)),
    );
    if (authSession) {
      await deleteSalesQuoteLocation(locationId, authSession.accessToken);
    }
  }

  // Migration 056: addable Sign/Space Sensor/Misc lines within a location's
  // details modal -- same optimistic-update-then-persist shape as the
  // handlers above.
  async function handleAddSalesQuoteLocationItem(
    quoteId: string,
    locationId: string,
    lineType: SalesQuoteLocationItem["lineType"],
    catalogItemId: string,
    qty: number,
    extra: { locationLabel?: string; accessoryCatalogItemId?: string | null; accessoryQty?: number } = {},
  ) {
    if (!authSession || !catalogItemId) {
      return;
    }
    const quote = salesQuotes.find((entry) => entry.id === quoteId);
    const location = quote?.locations.find((entry) => entry.id === locationId);
    if (!location) {
      return;
    }
    const listKey = lineType === "sign" ? "signLines" : lineType === "sensor" ? "sensorLines" : lineType === "camera" ? "cameraLines" : "miscLines";
    const nextLineSort = location[listKey].length;
    const created = await addSalesQuoteLocationItem(locationId, lineType, catalogItemId, qty, nextLineSort, extra, authSession.accessToken);
    if (!created) {
      return;
    }
    setSalesQuotes((current) =>
      current.map((entryQuote) =>
        entryQuote.id === quoteId
          ? {
              ...entryQuote,
              locations: entryQuote.locations.map((entryLocation) =>
                entryLocation.id === locationId ? { ...entryLocation, [listKey]: [...entryLocation[listKey], created] } : entryLocation,
              ),
            }
          : entryQuote,
      ),
    );
  }

  async function handleUpdateSalesQuoteLocationItem(
    quoteId: string,
    locationId: string,
    itemId: string,
    updates: Partial<{ qty: number; locationLabel: string; accessoryCatalogItemId: string | null; accessoryQty: number }>,
  ) {
    if (!authSession) {
      return;
    }
    const applyUpdates = (line: SalesQuoteLocationItem) => (line.id === itemId ? { ...line, ...updates } : line);
    setSalesQuotes((current) =>
      current.map((entryQuote) =>
        entryQuote.id === quoteId
          ? {
              ...entryQuote,
              locations: entryQuote.locations.map((entryLocation) =>
                entryLocation.id === locationId
                  ? {
                      ...entryLocation,
                      signLines: entryLocation.signLines.map(applyUpdates),
                      sensorLines: entryLocation.sensorLines.map(applyUpdates),
                      miscLines: entryLocation.miscLines.map(applyUpdates),
                      cameraLines: entryLocation.cameraLines.map(applyUpdates),
                    }
                  : entryLocation,
              ),
            }
          : entryQuote,
      ),
    );
    await updateSalesQuoteLocationItem(itemId, updates, authSession.accessToken);
  }

  async function handleDeleteSalesQuoteLocationItem(quoteId: string, locationId: string, itemId: string) {
    if (!authSession) {
      return;
    }
    setSalesQuotes((current) =>
      current.map((entryQuote) =>
        entryQuote.id === quoteId
          ? {
              ...entryQuote,
              locations: entryQuote.locations.map((entryLocation) =>
                entryLocation.id === locationId
                  ? {
                      ...entryLocation,
                      signLines: entryLocation.signLines.filter((line) => line.id !== itemId),
                      sensorLines: entryLocation.sensorLines.filter((line) => line.id !== itemId),
                      miscLines: entryLocation.miscLines.filter((line) => line.id !== itemId),
                      cameraLines: entryLocation.cameraLines.filter((line) => line.id !== itemId),
                    }
                  : entryLocation,
              ),
            }
          : entryQuote,
      ),
    );
    await deleteSalesQuoteLocationItem(itemId, authSession.accessToken);
  }

  // "Pull Location Hardware into Quote BOM" -- rolls every location's real
  // catalog-linked selections (FLI/LPR/People Counting camera picks, Sign,
  // Space Sensor, Misc lines) up into the one flat Quote BOM that actually
  // becomes the pricing table on a Quote Proposal (migration 053), mirroring
  // how the real EnSight proposals E shared list one row per product with a
  // qty rather than per physical location. Regenerate-safe: it only ever
  // replaces the lines it previously created (source_location_id set),
  // never touches lines a rep typed in by hand at the quote level, so
  // clicking it again after editing a location's hardware just refreshes
  // the pulled-in rows instead of duplicating them.
  async function handlePullLocationHardwareIntoQuoteBom(quoteId: string) {
    if (!authSession) {
      return;
    }
    const quote = salesQuotes.find((entry) => entry.id === quoteId);
    if (!quote) {
      return;
    }
    setSalesQuoteStatus("Pulling location hardware into the Quote BOM...");
    try {
      const lines: Array<{ item: string; qty: number; notes?: string; catalogItemId?: string | null; sourceLocationId?: string | null }> = [];

      for (const location of quote.locations) {
        const locationLabel = location.name || (location.locationType === "garage" ? "Garage" : "Lot");

        const pushCamera = (catalogItemId: string | null, capability: string) => {
          if (!catalogItemId) {
            return;
          }
          const catalogItem = catalogItems.find((item) => item.id === catalogItemId);
          lines.push({
            item: catalogItem ? catalogItem.productName : "Item removed from catalog",
            qty: 1,
            notes: `${locationLabel} -- ${capability}`,
            catalogItemId,
            sourceLocationId: location.id,
          });
        };
        // qty is always 1 here -- there's no separate "how many FLI/LPR/
        // People Counting cameras" count, just a single model pick per
        // capability per location. Entry/Exit/Level camera counts stay in
        // the Recommended Hardware estimate only, since those aren't tied
        // to a specific catalog item yet.
        if (location.fli) pushCamera(location.fliCameraItemId, "FLI camera");
        if (location.lpr) pushCamera(location.lprCameraItemId, "LPR camera");
        if (location.peopleCounting) pushCamera(location.peopleCountingCameraItemId, "People counting camera");

        const pushLines = (items: SalesQuoteLocationItem[], sectionLabel: string) => {
          for (const lineItem of items) {
            const lineLabel = `${locationLabel}${lineItem.locationLabel ? ` (${lineItem.locationLabel})` : ""} -- ${sectionLabel}`;
            if (lineItem.catalogItemId) {
              const catalogItem = catalogItems.find((item) => item.id === lineItem.catalogItemId);
              lines.push({
                item: catalogItem ? catalogItem.productName : "Item removed from catalog",
                qty: lineItem.qty,
                notes: lineLabel,
                catalogItemId: lineItem.catalogItemId,
                sourceLocationId: location.id,
              });
            }
            if (lineItem.accessoryCatalogItemId && lineItem.accessoryQty > 0) {
              const accessoryItem = catalogItems.find((item) => item.id === lineItem.accessoryCatalogItemId);
              lines.push({
                item: accessoryItem ? accessoryItem.productName : "Item removed from catalog",
                qty: lineItem.accessoryQty,
                notes: `${lineLabel} accessory`,
                catalogItemId: lineItem.accessoryCatalogItemId,
                sourceLocationId: location.id,
              });
            }
          }
        };
        pushLines(location.cameraLines, "Camera");
        pushLines(location.signLines, "Sign");
        pushLines(location.sensorLines, "Space Sensor");
        pushLines(location.miscLines, "Misc.");
      }

      if (lines.length === 0) {
        setSalesQuoteStatus("No location hardware selections yet -- pick camera models or add Sign/Space Sensor/Misc lines first.");
        return;
      }

      await deleteSalesQuoteBomLinesByLocationSource(quoteId, authSession.accessToken);
      const manualLines = quote.bomLines.filter((line) => !line.sourceLocationId);
      const created = await addSalesQuoteBomLines(quoteId, lines, manualLines.length, authSession.accessToken);
      setSalesQuotes((current) => current.map((entry) => (entry.id === quoteId ? { ...entry, bomLines: [...manualLines, ...created] } : entry)));
      setSalesQuoteStatus(`Pulled ${created.length} line(s) from ${quote.locations.length} location(s) into the Quote BOM.`);
    } catch (error) {
      setSalesQuoteStatus(error instanceof Error ? error.message : "Could not pull location hardware into the Quote BOM.");
    }
  }

  async function handleUpdateSalesQuoteStatus(quoteId: string, status: SalesQuote["status"]) {
    if (!authSession) {
      return;
    }
    // Any move into a closed state (re)stamps closedAt to now; reopening to
    // "open" clears it. This is what the Sales metric row's "Closed This
    // Year" and "Est. Profit (YTD)" filter on.
    const closedAt = status === "open" ? null : new Date().toISOString();
    setSalesQuotes((current) => current.map((entry) => (entry.id === quoteId ? { ...entry, status, closedAt: closedAt ?? "" } : entry)));
    await updateSalesQuoteStatus(quoteId, status, closedAt, authSession.accessToken);
  }

  async function handleDeleteSalesQuote(quoteId: string) {
    setSalesQuotes((current) => current.filter((entry) => entry.id !== quoteId));
    if (authSession) {
      await deleteSalesQuote(quoteId, authSession.accessToken);
    }
  }

  // Shared by the manual "add line" form and the Pre-Sales Quick Estimate
  // calculator below -- both just need to append lines to a quote's
  // persisted BOM.
  async function handleAddSalesQuoteBomLines(quoteId: string, lines: Array<{ item: string; qty: number; notes?: string; catalogItemId?: string | null }>) {
    if (!authSession || lines.length === 0) {
      return;
    }
    const quote = salesQuotes.find((entry) => entry.id === quoteId);
    if (!quote) {
      return;
    }
    try {
      const created = await addSalesQuoteBomLines(quoteId, lines, quote.bomLines.length, authSession.accessToken);
      setSalesQuotes((current) => current.map((entry) => (entry.id === quoteId ? { ...entry, bomLines: [...entry.bomLines, ...created] } : entry)));
    } catch (error) {
      setSalesQuoteStatus(error instanceof Error ? error.message : "Could not update the quote BOM.");
    }
  }

  async function handleUpdateSalesQuoteBomLineCatalogLink(quoteId: string, lineId: string, catalogItemId: string | null) {
    if (!authSession) {
      return;
    }
    setSalesQuotes((current) =>
      current.map((entry) =>
        entry.id === quoteId
          ? { ...entry, bomLines: entry.bomLines.map((line) => (line.id === lineId ? { ...line, catalogItemId } : line)) }
          : entry,
      ),
    );
    await updateSalesQuoteBomLineCatalogLink(lineId, catalogItemId, authSession.accessToken);
  }

  async function handleUpdateSalesQuoteProposalFields(quoteId: string, updates: Partial<{ clientEmail: string; proposalSummary: string }>) {
    if (!authSession) {
      return;
    }
    setSalesQuotes((current) => current.map((entry) => (entry.id === quoteId ? { ...entry, ...updates } : entry)));
    await updateSalesQuoteProposalFields(quoteId, updates, authSession.accessToken);
  }

  // #164 -- lets a rep get back to the original "New Site" intake fields
  // (client/site name, city) and correct them after the quote already
  // exists, instead of those being fixed at creation time forever.
  async function handleUpdateSalesQuoteInfo(
    quoteId: string,
    updates: Partial<{
      clientName: string;
      siteName: string;
      city: string;
      clientEmail: string;
      contactFullName: string;
      contactPhone: string;
      preferredCommunication: string;
      saasType: string;
      saasContractAmount: number | null;
      saasBillingFrequency: SalesQuote["saasBillingFrequency"];
    }>,
  ) {
    if (!authSession) {
      return;
    }
    setSalesQuotes((current) => current.map((entry) => (entry.id === quoteId ? { ...entry, ...updates } : entry)));
    try {
      await updateSalesQuoteInfo(quoteId, updates, authSession.accessToken);
    } catch (error) {
      setSalesQuoteStatus(error instanceof Error ? error.message : "Could not update site info.");
    }
  }

  // #165 -- growing, admin-configurable questionnaire of sales/client-facing
  // questions tied to each quote (Phase 18 Fluid Form Engine, form_key
  // "sales_site_intake"). One response row per quote, upserted as the rep
  // fills in answers -- mirrors the After-Sales Handover pattern but keyed
  // by quote instead of a separate handover record.
  function handleLoadSalesQuoteIntakeResponse(quoteId: string) {
    if (!authSession) {
      return;
    }
    loadSalesQuoteIntakeResponse(quoteId, authSession.accessToken)
      .then((response) => {
        if (response) {
          setQuoteIntakeResponses((current) => ({ ...current, [quoteId]: response }));
        }
      })
      .catch((error) => setQuoteIntakeStatus(error instanceof Error ? error.message : "Could not load the site intake questionnaire."));
  }

  async function handleSaveSalesQuoteIntakeResponses(quoteId: string, responses: Record<string, string>) {
    if (!authSession || !siteIntakeSchema) {
      return;
    }
    try {
      const saved = await upsertSalesQuoteIntakeResponse(quoteId, siteIntakeSchema.id, responses, authSession.accessToken);
      if (saved) {
        setQuoteIntakeResponses((current) => ({ ...current, [quoteId]: saved }));
      }
    } catch (error) {
      setQuoteIntakeStatus(error instanceof Error ? error.message : "Could not save the site intake questionnaire.");
    }
  }

  async function handleDeleteSalesQuoteBomLine(quoteId: string, lineId: string) {
    if (!authSession) {
      return;
    }
    setSalesQuotes((current) => current.map((entry) => (entry.id === quoteId ? { ...entry, bomLines: entry.bomLines.filter((line) => line.id !== lineId) } : entry)));
    await deleteSalesQuoteBomLine(lineId, authSession.accessToken);
  }

  async function handleUploadSalesQuoteImage(
    quoteId: string,
    locationId: string,
    imageType: "photo" | "drawing",
    file: File,
    description?: string,
    coords?: { lat: number; lng: number } | null,
  ): Promise<boolean> {
    if (!authSession) {
      return false;
    }
    if (imageType === "photo" && !isAllowedPhotoFile(file)) {
      window.alert("Photos only accept image files. Use Files for PDF, Word, Excel, CAD, and other documents.");
      return false;
    }
    if (imageType === "drawing" && !isAllowedLocationDocumentFile(file)) {
      window.alert("Files only accept documents and CAD/reference files. Use Photos for uploaded pictures.");
      return false;
    }
    const image = await addSalesQuoteLocationImage(locationId, imageType, file, authSession.accessToken, description, authSession.email, coords ?? null);
    if (image) {
      setSalesQuotes((current) =>
        current.map((entry) =>
          entry.id === quoteId
            ? { ...entry, locations: entry.locations.map((location) => (location.id === locationId ? { ...location, images: [...location.images, image] } : location)) }
            : entry,
        ),
      );
      return true;
    }
    return false;
  }

  // Uploads any Site Builder photos that were queued in IndexedDB because
  // the device was offline when they were captured (see persistence.ts's
  // offline photo queue + CameraCaptureModal.saveAll). Called on load, on
  // the browser's `online` event, and on an interval so a photo taken with
  // no signal in a parking garage uploads itself the moment the rep is back
  // in range -- no manual retry needed.
  async function flushPendingSitePhotos() {
    if (!authSession) {
      return;
    }
    const pending = await listPendingSitePhotos();
    if (pending.length === 0) {
      setPendingPhotoCount(0);
      return;
    }
    for (const item of pending) {
      const file = new File([item.blob], item.fileName, { type: item.fileType || "image/jpeg" });
      const coords = item.lat != null && item.lng != null ? { lat: item.lat, lng: item.lng } : null;
      const ok =
        item.ownerType === "project"
          ? await handleUploadProjectLocationImage(item.quoteId, item.locationId, "photo", file, item.description, coords).catch(() => false)
          : await handleUploadSalesQuoteImage(item.quoteId, item.locationId, "photo", file, item.description, coords).catch(() => false);
      if (ok) {
        await removePendingSitePhoto(item.id);
      }
    }
    const remaining = await listPendingSitePhotos();
    setPendingPhotoCount(remaining.length);
  }

  async function handleUpdateSalesQuoteImageDescription(quoteId: string, locationId: string, imageId: string, description: string) {
    if (!authSession) {
      return;
    }
    setSalesQuotes((current) =>
      current.map((entry) =>
        entry.id === quoteId
          ? {
              ...entry,
              locations: entry.locations.map((location) =>
                location.id === locationId
                  ? { ...location, images: location.images.map((image) => (image.id === imageId ? { ...image, description } : image)) }
                  : location,
              ),
            }
          : entry,
      ),
    );
    await updateSalesQuoteLocationImageDescription(imageId, description, authSession.accessToken);
  }

  async function handleUpdateSalesQuoteImageMeta(
    quoteId: string,
    locationId: string,
    imageId: string,
    updates: Partial<{ fileName: string; description: string }>,
  ): Promise<boolean> {
    if (!authSession) {
      return false;
    }
    setSalesQuotes((current) =>
      current.map((entry) =>
        entry.id === quoteId
          ? {
              ...entry,
              locations: entry.locations.map((location) =>
                location.id === locationId
                  ? {
                      ...location,
                      images: location.images.map((image) =>
                        image.id === imageId
                          ? { ...image, fileName: updates.fileName ?? image.fileName, description: updates.description ?? image.description }
                          : image,
                      ),
                    }
                  : location,
              ),
            }
          : entry,
      ),
    );
    return updateSalesQuoteLocationImageMeta(imageId, updates, authSession.accessToken);
  }

  async function handleMoveSalesQuoteImage(quoteId: string, fromLocationId: string, imageId: string, targetLocationId: string): Promise<boolean> {
    if (!authSession || fromLocationId === targetLocationId) {
      return false;
    }
    const quote = salesQuotes.find((entry) => entry.id === quoteId);
    const movingImage = quote?.locations.find((location) => location.id === fromLocationId)?.images.find((image) => image.id === imageId);
    if (!movingImage) {
      return false;
    }
    setSalesQuotes((current) =>
      current.map((entry) =>
        entry.id === quoteId
          ? {
              ...entry,
              locations: entry.locations.map((location) =>
                location.id === fromLocationId
                  ? { ...location, images: location.images.filter((image) => image.id !== imageId) }
                  : location.id === targetLocationId
                    ? { ...location, images: [...location.images, movingImage] }
                    : location,
              ),
            }
          : entry,
      ),
    );
    return moveSalesQuoteLocationImage(imageId, targetLocationId, authSession.accessToken);
  }

  async function handleDeleteSalesQuoteImage(quoteId: string, locationId: string, imageId: string, storagePath: string): Promise<boolean> {
    if (!authSession) {
      return false;
    }
    const ok = await deleteSalesQuoteLocationImage(imageId, storagePath, authSession.accessToken);
    if (ok) {
      setSalesQuotes((current) =>
        current.map((entry) =>
          entry.id === quoteId
            ? {
                ...entry,
                locations: entry.locations.map((location) =>
                  location.id === locationId ? { ...location, images: location.images.filter((image) => image.id !== imageId) } : location,
                ),
              }
            : entry,
        ),
      );
    }
    return ok;
  }

  async function handleGetSalesQuoteImageUrl(image: SalesQuoteLocationImage): Promise<string | null> {
    if (!authSession) {
      return null;
    }
    return getQuoteImageDownloadUrl(image.storagePath, authSession.accessToken);
  }

  // --- Project Locations ---------------------------------------------------
  // Mirror of the Sales Quote location handlers above, one-to-one, so a
  // Project's own "Locations" tab (built from scratch, or pre-populated by
  // createProjectFromClosedWonQuote) behaves identically. Keyed by
  // projectRef (like onPullBomFromClosedQuote) since that's what the
  // Project detail UI already threads around; the underlying persistence
  // calls need the real project_id, resolved from the matching ProjectSite.

  async function handleAddProjectLocation(projectRef: string, locationType: "garage" | "lot") {
    if (!authSession) {
      return;
    }
    const project = projectSites.find((entry) => entry.ref === projectRef);
    if (!project?.id) {
      return;
    }
    const nextLineSort = (project.locations ?? []).length;
    const created = await addProjectLocation(project.id, locationType, nextLineSort, authSession.accessToken);
    if (created) {
      setProjectSites((current) =>
        current.map((entry) => (entry.ref === projectRef ? { ...entry, locations: [...(entry.locations ?? []), created] } : entry)),
      );
    }
  }

  async function handleUpdateProjectLocation(projectRef: string, locationId: string, updates: Parameters<typeof updateProjectLocation>[1]) {
    setProjectSites((current) =>
      current.map((entry) =>
        entry.ref === projectRef
          ? { ...entry, locations: (entry.locations ?? []).map((location) => (location.id === locationId ? { ...location, ...updates } : location)) }
          : entry,
      ),
    );
    if (authSession) {
      await updateProjectLocation(locationId, updates, authSession.accessToken);
    }
  }

  async function handleDeleteProjectLocation(projectRef: string, locationId: string) {
    setProjectSites((current) =>
      current.map((entry) =>
        entry.ref === projectRef ? { ...entry, locations: (entry.locations ?? []).filter((location) => location.id !== locationId) } : entry,
      ),
    );
    if (authSession) {
      await deleteProjectLocation(locationId, authSession.accessToken);
    }
  }

  async function handleAddProjectLocationItem(
    projectRef: string,
    locationId: string,
    lineType: ProjectLocationItem["lineType"],
    catalogItemId: string,
    qty: number,
    extra: { locationLabel?: string; accessoryCatalogItemId?: string | null; accessoryQty?: number } = {},
  ) {
    if (!authSession || !catalogItemId) {
      return;
    }
    const project = projectSites.find((entry) => entry.ref === projectRef);
    const location = project?.locations?.find((entry) => entry.id === locationId);
    if (!location) {
      return;
    }
    const listKey = lineType === "sign" ? "signLines" : lineType === "sensor" ? "sensorLines" : lineType === "camera" ? "cameraLines" : "miscLines";
    const nextLineSort = location[listKey].length;
    const created = await addProjectLocationItem(locationId, lineType, catalogItemId, qty, nextLineSort, extra, authSession.accessToken);
    if (!created) {
      return;
    }
    setProjectSites((current) =>
      current.map((entryProject) =>
        entryProject.ref === projectRef
          ? {
              ...entryProject,
              locations: (entryProject.locations ?? []).map((entryLocation) =>
                entryLocation.id === locationId ? { ...entryLocation, [listKey]: [...entryLocation[listKey], created] } : entryLocation,
              ),
            }
          : entryProject,
      ),
    );
  }

  async function handleUpdateProjectLocationItem(
    projectRef: string,
    locationId: string,
    itemId: string,
    updates: Partial<{ qty: number; locationLabel: string; accessoryCatalogItemId: string | null; accessoryQty: number }>,
  ) {
    if (!authSession) {
      return;
    }
    const applyUpdates = (line: ProjectLocationItem) => (line.id === itemId ? { ...line, ...updates } : line);
    setProjectSites((current) =>
      current.map((entryProject) =>
        entryProject.ref === projectRef
          ? {
              ...entryProject,
              locations: (entryProject.locations ?? []).map((entryLocation) =>
                entryLocation.id === locationId
                  ? {
                      ...entryLocation,
                      signLines: entryLocation.signLines.map(applyUpdates),
                      sensorLines: entryLocation.sensorLines.map(applyUpdates),
                      miscLines: entryLocation.miscLines.map(applyUpdates),
                      cameraLines: entryLocation.cameraLines.map(applyUpdates),
                    }
                  : entryLocation,
              ),
            }
          : entryProject,
      ),
    );
    await updateProjectLocationItem(itemId, updates, authSession.accessToken);
  }

  async function handleDeleteProjectLocationItem(projectRef: string, locationId: string, itemId: string) {
    if (!authSession) {
      return;
    }
    setProjectSites((current) =>
      current.map((entryProject) =>
        entryProject.ref === projectRef
          ? {
              ...entryProject,
              locations: (entryProject.locations ?? []).map((entryLocation) =>
                entryLocation.id === locationId
                  ? {
                      ...entryLocation,
                      signLines: entryLocation.signLines.filter((line) => line.id !== itemId),
                      sensorLines: entryLocation.sensorLines.filter((line) => line.id !== itemId),
                      miscLines: entryLocation.miscLines.filter((line) => line.id !== itemId),
                      cameraLines: entryLocation.cameraLines.filter((line) => line.id !== itemId),
                    }
                  : entryLocation,
              ),
            }
          : entryProject,
      ),
    );
    await deleteProjectLocationItem(itemId, authSession.accessToken);
  }

  async function handleUploadProjectLocationImage(
    projectRef: string,
    locationId: string,
    imageType: "photo" | "drawing",
    file: File,
    description?: string,
    coords?: { lat: number; lng: number } | null,
  ): Promise<boolean> {
    if (!authSession) {
      return false;
    }
    if (imageType === "photo" && !isAllowedPhotoFile(file)) {
      window.alert("Photos only accept image files. Use Files for PDF, Word, Excel, CAD, and other documents.");
      return false;
    }
    if (imageType === "drawing" && !isAllowedLocationDocumentFile(file)) {
      window.alert("Files only accept documents and CAD/reference files. Use Photos for uploaded pictures.");
      return false;
    }
    const image = await addProjectLocationImage(locationId, imageType, file, authSession.accessToken, description, authSession.email, coords ?? null);
    if (image) {
      setProjectSites((current) =>
        current.map((entry) =>
          entry.ref === projectRef
            ? { ...entry, locations: (entry.locations ?? []).map((location) => (location.id === locationId ? { ...location, images: [...location.images, image] } : location)) }
            : entry,
        ),
      );
      return true;
    }
    return false;
  }

  async function handleUpdateProjectLocationImageDescription(projectRef: string, locationId: string, imageId: string, description: string) {
    if (!authSession) {
      return;
    }
    setProjectSites((current) =>
      current.map((entry) =>
        entry.ref === projectRef
          ? {
              ...entry,
              locations: (entry.locations ?? []).map((location) =>
                location.id === locationId
                  ? { ...location, images: location.images.map((image) => (image.id === imageId ? { ...image, description } : image)) }
                  : location,
              ),
            }
          : entry,
      ),
    );
    await updateProjectLocationImageDescription(imageId, description, authSession.accessToken);
  }

  async function handleUpdateProjectLocationImageMeta(
    projectRef: string,
    locationId: string,
    imageId: string,
    updates: Partial<{ fileName: string; description: string }>,
  ): Promise<boolean> {
    if (!authSession) {
      return false;
    }
    setProjectSites((current) =>
      current.map((entry) =>
        entry.ref === projectRef
          ? {
              ...entry,
              locations: (entry.locations ?? []).map((location) =>
                location.id === locationId
                  ? {
                      ...location,
                      images: location.images.map((image) =>
                        image.id === imageId
                          ? { ...image, fileName: updates.fileName ?? image.fileName, description: updates.description ?? image.description }
                          : image,
                      ),
                    }
                  : location,
              ),
            }
          : entry,
      ),
    );
    return updateProjectLocationImageMeta(imageId, updates, authSession.accessToken);
  }

  async function handleMoveProjectLocationImage(projectRef: string, fromLocationId: string, imageId: string, targetLocationId: string): Promise<boolean> {
    if (!authSession || fromLocationId === targetLocationId) {
      return false;
    }
    const project = projectSites.find((entry) => entry.ref === projectRef);
    const movingImage = project?.locations?.find((location) => location.id === fromLocationId)?.images.find((image) => image.id === imageId);
    if (!movingImage) {
      return false;
    }
    setProjectSites((current) =>
      current.map((entry) =>
        entry.ref === projectRef
          ? {
              ...entry,
              locations: (entry.locations ?? []).map((location) =>
                location.id === fromLocationId
                  ? { ...location, images: location.images.filter((image) => image.id !== imageId) }
                  : location.id === targetLocationId
                    ? { ...location, images: [...location.images, movingImage] }
                    : location,
              ),
            }
          : entry,
      ),
    );
    return moveProjectLocationImage(imageId, targetLocationId, authSession.accessToken);
  }

  async function handleDeleteProjectLocationImage(projectRef: string, locationId: string, imageId: string, storagePath: string): Promise<boolean> {
    if (!authSession) {
      return false;
    }
    const ok = await deleteProjectLocationImage(imageId, storagePath, authSession.accessToken);
    if (ok) {
      setProjectSites((current) =>
        current.map((entry) =>
          entry.ref === projectRef
            ? {
                ...entry,
                locations: (entry.locations ?? []).map((location) =>
                  location.id === locationId ? { ...location, images: location.images.filter((image) => image.id !== imageId) } : location,
                ),
              }
            : entry,
        ),
      );
    }
    return ok;
  }

  async function handleGetProjectLocationImageUrl(image: ProjectLocationImage): Promise<string | null> {
    if (!authSession) {
      return null;
    }
    return getProjectLocationImageDownloadUrl(image.storagePath, authSession.accessToken);
  }

  // PM shipping requests, fulfilled by Warehouse/Implementation:
  // Requested -> Packed (photos) -> Shipped (carrier + tracking).
  async function handleAddProjectShippingAddress(
    projectRef: string,
    address: { label: string; streetAddress: string; city: string; state: string; zip: string; attnName: string; phone: string },
  ) {
    if (!authSession) {
      return;
    }
    const project = projectSites.find((entry) => entry.ref === projectRef);
    if (!project?.id) {
      return;
    }
    const nextLineSort = (project.shippingAddresses ?? []).length;
    const created = await addProjectShippingAddress(project.id, address, nextLineSort, authSession.accessToken);
    if (!created) {
      return;
    }
    setProjectSites((current) =>
      current.map((entry) => (entry.ref === projectRef ? { ...entry, shippingAddresses: [...(entry.shippingAddresses ?? []), created] } : entry)),
    );
  }

  async function handleAddProjectShipment(
    projectRef: string,
    addressId: string | null,
    addressSnapshot: string,
    notes: string,
    lines: Array<{ itemName: string; qty: number }>,
  ) {
    if (!authSession || lines.length === 0) {
      return;
    }
    const project = projectSites.find((entry) => entry.ref === projectRef);
    if (!project?.id) {
      return;
    }
    const nextNumber = shipmentNumber((project.shipments ?? []).length);
    const created = await addProjectShipment(project.id, nextNumber, addressId, addressSnapshot, authSession.email, notes, lines, authSession.accessToken);
    if (!created) {
      return;
    }
    setProjectSites((current) =>
      current.map((entry) => (entry.ref === projectRef ? { ...entry, shipments: [created, ...(entry.shipments ?? [])] } : entry)),
    );
  }

  async function handleMarkProjectShipmentPacked(projectRef: string, shipmentId: string) {
    if (!authSession) {
      return;
    }
    const packedAt = new Date().toISOString();
    setProjectSites((current) =>
      current.map((entry) =>
        entry.ref === projectRef
          ? {
              ...entry,
              shipments: (entry.shipments ?? []).map((shipment) =>
                shipment.id === shipmentId ? { ...shipment, status: "Packed", packedByEmail: authSession.email, packedAt } : shipment,
              ),
            }
          : entry,
      ),
    );
    await updateProjectShipment(shipmentId, { status: "Packed", packedByEmail: authSession.email, packedAt }, authSession.accessToken);
  }

  async function handleMarkProjectShipmentShipped(projectRef: string, shipmentId: string, carrier: string, trackingNumber: string) {
    if (!authSession) {
      return;
    }
    const project = projectSites.find((entry) => entry.ref === projectRef);
    const shipment = project?.shipments?.find((entry) => entry.id === shipmentId);
    if (!project || !shipment) {
      return;
    }
    const shippedAt = new Date().toISOString();
    setProjectSites((current) =>
      current.map((entry) =>
        entry.ref === projectRef
          ? {
              ...entry,
              shipments: (entry.shipments ?? []).map((entryShipment) =>
                entryShipment.id === shipmentId
                  ? { ...entryShipment, status: "Shipped", carrier, trackingNumber, shippedByEmail: authSession.email, shippedAt }
                  : entryShipment,
              ),
            }
          : entry,
      ),
    );
    await updateProjectShipment(shipmentId, { status: "Shipped", carrier, trackingNumber, shippedByEmail: authSession.email, shippedAt }, authSession.accessToken);
    // Shipping is a real stock movement, same as Transfer to Project -- pull
    // each line's qty out of inventory now, not at request time, since a
    // request can sit for a while before it actually goes out the door.
    for (const line of shipment.lines) {
      pullFromInventory(line.itemName, line.qty, project.name, `Shipped via ${shipment.shipmentNumber}${carrier ? ` (${carrier})` : ""}${trackingNumber ? ` -- ${trackingNumber}` : ""}`);
    }
  }

  async function handleUploadProjectShipmentPhoto(projectRef: string, shipmentId: string, file: File, description?: string): Promise<boolean> {
    if (!authSession) {
      return false;
    }
    if (!isAllowedPhotoFile(file)) {
      window.alert("Shipment photos only accept image files.");
      return false;
    }
    const created = await addProjectShipmentPhoto(shipmentId, file, authSession.accessToken, description, authSession.email);
    if (!created) {
      return false;
    }
    setProjectSites((current) =>
      current.map((entry) =>
        entry.ref === projectRef
          ? {
              ...entry,
              shipments: (entry.shipments ?? []).map((shipment) =>
                shipment.id === shipmentId ? { ...shipment, photos: [...shipment.photos, created] } : shipment,
              ),
            }
          : entry,
      ),
    );
    return true;
  }

  async function handleDeleteProjectShipmentPhoto(projectRef: string, shipmentId: string, photoId: string, storagePath: string): Promise<boolean> {
    if (!authSession) {
      return false;
    }
    const ok = await deleteProjectShipmentPhoto(photoId, storagePath, authSession.accessToken);
    if (ok) {
      setProjectSites((current) =>
        current.map((entry) =>
          entry.ref === projectRef
            ? {
                ...entry,
                shipments: (entry.shipments ?? []).map((shipment) =>
                  shipment.id === shipmentId ? { ...shipment, photos: shipment.photos.filter((photo) => photo.id !== photoId) } : shipment,
                ),
              }
            : entry,
        ),
      );
    }
    return ok;
  }

  async function handleGetProjectShipmentPhotoUrl(storagePath: string): Promise<string | null> {
    if (!authSession) {
      return null;
    }
    return getShipmentPhotoDownloadUrl(storagePath, authSession.accessToken);
  }

  // E's request: closing a Sales Quote should offer to spin up a Project
  // that starts with everything the quote has -- contact info, BOM, and the
  // full per-garage/lot breakdown including photos/drawings -- in the same
  // format, so media can be tracked from presale through closeout. Prompted
  // from Site Builder when a quote's status is set to Closed - Won.
  async function handleCreateProjectFromClosedWonQuote(quote: SalesQuote): Promise<ProjectSite | null> {
    if (!authSession) {
      return null;
    }
    const created = await createProjectFromClosedWonQuote(quote, authSession.accessToken);
    if (created) {
      setProjectSites((current) => {
        const existingIndex = current.findIndex((entry) => entry.name === created.name);
        if (existingIndex >= 0) {
          const next = current.slice();
          next[existingIndex] = created;
          return next;
        }
        return [...current, created];
      });
    }
    return created;
  }

  async function handleDownloadSalesQuoteImage(image: SalesQuoteLocationImage) {
    if (!authSession) {
      return;
    }
    const url = await getQuoteImageDownloadUrl(image.storagePath, authSession.accessToken);
    if (url) {
      await triggerBrowserDownload(url, image.fileName || "photo");
    }
  }

  async function handleDownloadProjectLocationImage(image: ProjectLocationImage) {
    if (!authSession) {
      return;
    }
    const url = await getProjectLocationImageDownloadUrl(image.storagePath, authSession.accessToken);
    if (url) {
      await triggerBrowserDownload(url, image.fileName || "photo");
    }
  }

  function reloadTasks(accessToken: string) {
    loadTasks(accessToken)
      .then(setTasks)
      .catch(() => setTaskStatusMessage("Could not load tasks."));
    loadDeletedTasks(accessToken)
      .then(setDeletedTasks)
      .catch(() => undefined);
    loadAllTaskActivity(accessToken)
      .then(setTaskActivity)
      .catch(() => undefined);
  }

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setTasks([]);
      setDeletedTasks([]);
      setTaskActivity([]);
      return;
    }
    reloadTasks(authSession.accessToken);
  }, [authSession]);

  function logTaskActivityLocally(taskId: string, message: string) {
    if (!authSession) {
      return;
    }
    void addTaskActivity(taskId, authSession.email, message, authSession.accessToken);
    setTaskActivity((current) => [
      { id: makeId("activity"), taskId, actorEmail: authSession.email, message, createdAt: new Date().toISOString() },
      ...current,
    ]);
  }

  async function handleCreateTask(task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">): Promise<boolean> {
    if (!authSession) {
      setTaskStatusMessage("You must be signed in to create a task.");
      return false;
    }
    try {
      const created = await createTask(task, authSession.userId, authSession.email, authSession.accessToken);
      setTasks((current) => [created, ...current]);
      setTaskStatusMessage(`${created.title} added.`);
      logTaskActivityLocally(created.id, "Created the task.");
      if (created.assigneeEmail) {
        notify("task_assigned", created.assigneeEmail, "New task assigned", `"${created.title}" was assigned to you.`, "task", created.id, `task_assigned:${created.id}:${created.assigneeEmail}`);
      } else if (created.assignedRoleKey) {
        notifyRoleAssignment(created.assignedRoleKey, "New task for your team", created.id, created.title);
      }
      return true;
    } catch (error) {
      setTaskStatusMessage(error instanceof Error ? error.message : "Could not create task.");
      return false;
    }
  }

  async function handleUpdateTask(id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>): Promise<boolean> {
    if (!authSession) {
      setTaskStatusMessage("You must be signed in to update a task.");
      return false;
    }
    try {
      const previous = tasks.find((existing) => existing.id === id);
      // Close/Reopen is just a status change to/from "done", but it's always
      // stamped here -- the one place that actually knows who's signed in --
      // rather than relying on whatever triggered the status change (a
      // dropdown pick or the modal's dedicated Close/Reopen button) to also
      // know the current user's email.
      const payload: Partial<Omit<EOTask, "id" | "taskNumber">> = { ...task };
      if (task.status === "done" && previous?.status !== "done") {
        payload.closedByEmail = authSession.email;
        payload.closedAt = new Date().toISOString();
      } else if (task.status !== undefined && task.status !== "done" && previous?.status === "done") {
        payload.closedByEmail = "";
        payload.closedAt = "";
      }
      const updated = await updateTask(id, payload, authSession.accessToken);
      setTasks((current) => current.map((existing) => (existing.id === id ? updated : existing)));
      setTaskStatusMessage(`${updated.title} updated.`);
      if (previous) {
        logTaskActivityLocally(id, describeTaskChanges(previous, updated));
      }
      if (updated.assigneeEmail && updated.assigneeEmail !== previous?.assigneeEmail) {
        notify("task_assigned", updated.assigneeEmail, "Task assigned", `"${updated.title}" was assigned to you.`, "task", updated.id, `task_assigned:${updated.id}:${updated.assigneeEmail}`);
      } else if (updated.assignedRoleKey && updated.assignedRoleKey !== previous?.assignedRoleKey) {
        notifyRoleAssignment(updated.assignedRoleKey, "Task assigned to your team", updated.id, updated.title);
      }
      if (previous && updated.status !== previous.status) {
        const statusLabel = TASK_STATUS_OPTIONS.find((option) => option.value === updated.status)?.label ?? updated.status;
        notifyCurrentTaskAssignees(
          updated,
          "task_status_changed",
          "Task status changed",
          `"${updated.title}" moved to ${statusLabel}.`,
          updated.status,
        );
        // Creator gets told too, not just whoever it's currently assigned
        // to -- skip if they're also the assignee (already covered above)
        // or if they're the one who just made the change themselves.
        const actingEmail = authSession.email?.toLowerCase() ?? "";
        const creatorEmail = updated.createdByEmail?.toLowerCase() ?? "";
        const assigneeEmail = updated.assigneeEmail?.toLowerCase() ?? "";
        if (creatorEmail && creatorEmail !== actingEmail && creatorEmail !== assigneeEmail) {
          const today = new Date().toISOString().slice(0, 10);
          notify(
            "task_status_changed",
            updated.createdByEmail,
            "Task status changed",
            `"${updated.title}" moved to ${statusLabel}.`,
            "task",
            updated.id,
            `task_status_changed:${updated.id}:${updated.createdByEmail}:${updated.status}:${today}`,
          );
        }
      }
      if (updated.status === "in_progress" && previous?.status !== "in_progress") {
        runTaskHardwareAutomation(updated);
      }
      return true;
    } catch (error) {
      setTaskStatusMessage(error instanceof Error ? error.message : "Could not update task.");
      return false;
    }
  }

  // Soft delete: the row and its full activity history stay in the
  // database (see persistence.ts's updateTask/deletedByEmail comments), just
  // stamped with who and when, and dropped out of the normal lists. That
  // keeps deletion reversible and reviewable in the Deleted Tasks panel
  // instead of a real destructive action anyone could trigger with one click.
  async function handleDeleteTask(id: string): Promise<boolean> {
    if (!authSession) {
      setTaskStatusMessage("You must be signed in to delete a task.");
      return false;
    }
    const target = tasks.find((existing) => existing.id === id);
    if (!window.confirm(`Delete "${target?.title ?? "this task"}"? It disappears from every task list, but who deleted it and when is kept on record, and it can be restored from the Deleted Tasks panel.`)) {
      return false;
    }
    try {
      const updated = await updateTask(id, { deletedByEmail: authSession.email, deletedAt: new Date().toISOString() }, authSession.accessToken);
      setTasks((current) => current.filter((existing) => existing.id !== id));
      setDeletedTasks((current) => [updated, ...current]);
      setTaskStatusMessage(`${updated.title} deleted.`);
      if (target) {
        logTaskActivityLocally(id, describeTaskChanges(target, updated));
      }
      return true;
    } catch (error) {
      setTaskStatusMessage(error instanceof Error ? error.message : "Could not delete task.");
      return false;
    }
  }

  async function handleRestoreTask(id: string): Promise<boolean> {
    if (!authSession) {
      setTaskStatusMessage("You must be signed in to restore a task.");
      return false;
    }
    const target = deletedTasks.find((existing) => existing.id === id);
    try {
      const updated = await updateTask(id, { deletedByEmail: "", deletedAt: "" }, authSession.accessToken);
      setDeletedTasks((current) => current.filter((existing) => existing.id !== id));
      setTasks((current) => [updated, ...current]);
      setTaskStatusMessage(`${updated.title} restored.`);
      if (target) {
        logTaskActivityLocally(id, describeTaskChanges(target, updated));
      }
      return true;
    } catch (error) {
      setTaskStatusMessage(error instanceof Error ? error.message : "Could not restore task.");
      return false;
    }
  }

  function reloadTeamMembers(accessToken: string) {
    loadTeamMembers(accessToken)
      .then(setTeamMembers)
      .catch(() => setTeamMemberStatus("Could not load the team roster."));
  }

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setTeamMembers([]);
      return;
    }
    reloadTeamMembers(authSession.accessToken);
  }, [authSession]);

  async function handleAddTeamMember(member: Omit<TeamMember, "id">) {
    if (!authSession) {
      return;
    }
    try {
      const created = await createTeamMember(member, authSession.accessToken);
      setTeamMembers((current) => [...current, created].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      setTeamMemberStatus(`${created.fullName} added to the roster.`);
    } catch (error) {
      setTeamMemberStatus(error instanceof Error ? error.message : "Could not add team member.");
    }
  }

  async function handleUpdateTeamMember(id: string, member: Partial<Omit<TeamMember, "id">>) {
    if (!authSession) {
      return;
    }
    try {
      const updated = await updateTeamMember(id, member, authSession.accessToken);
      setTeamMembers((current) => current.map((existing) => (existing.id === id ? updated : existing)));
      setTeamMemberStatus(`${updated.fullName} updated.`);
    } catch (error) {
      setTeamMemberStatus(error instanceof Error ? error.message : "Could not update team member.");
    }
  }

  function reloadNotifications(email: string, accessToken: string) {
    loadNotifications(email, accessToken).then(setNotifications).catch(() => {});
  }

  useEffect(() => {
    if (!authSession || !authSession.email || !isRemotePersistenceConfigured()) {
      setNotifications([]);
      setNotificationRules([]);
      return;
    }
    reloadNotifications(authSession.email, authSession.accessToken);
    loadNotificationRules(authSession.accessToken).then(setNotificationRules).catch(() => {});
  }, [authSession]);

  function ruleActive(eventType: string, channel: string) {
    const rule = notificationRules.find((entry) => entry.eventType === eventType);
    return Boolean(rule?.isActive && rule.channels.includes(channel));
  }

  async function notify(eventType: string, recipientEmail: string, title: string, body: string, relatedEntityType: string, relatedEntityId: string, dedupeKey?: string) {
    if (!authSession || !recipientEmail) {
      return;
    }
    const inAppActive = ruleActive(eventType, "in_app");
    const emailActive = ruleActive(eventType, "email");
    const slackActive = ruleActive(eventType, "slack");
    if (!inAppActive && !emailActive && !slackActive) {
      return;
    }
    const created = await createNotification({ recipientEmail, eventType, title, body, relatedEntityType, relatedEntityId, dedupeKey }, authSession.accessToken).catch(() => null);
    if (recipientEmail.toLowerCase() === authSession.email?.toLowerCase()) {
      reloadNotifications(authSession.email, authSession.accessToken);
    }
    // created is null if this exact event was already recorded (dedupe_key
    // collision) or the insert failed -- either way, don't send a
    // duplicate/orphaned delivery.
    if (!created) {
      return;
    }
    if (emailActive) {
      try {
        const response = await fetch("/api/send-notification-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: recipientEmail, subject: title, body, companyName: branding.companyName }),
        });
        const result = (await response.json()) as { sent: boolean; reason?: string; error?: string };
        await recordNotificationDelivery(created.id, "email", result.sent ? "sent" : "skipped", result.sent ? undefined : (result.reason || result.error), authSession.accessToken);
      } catch (error) {
        await recordNotificationDelivery(created.id, "email", "failed", error instanceof Error ? error.message : "Unknown error", authSession.accessToken).catch(() => {});
      }
    }
    if (slackActive) {
      try {
        const response = await fetch("/api/send-notification-slack", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, body }),
        });
        const result = (await response.json()) as { sent: boolean; reason?: string; error?: string };
        await recordNotificationDelivery(created.id, "slack", result.sent ? "sent" : "skipped", result.sent ? undefined : (result.reason || result.error), authSession.accessToken);
      } catch (error) {
        await recordNotificationDelivery(created.id, "slack", "failed", error instanceof Error ? error.message : "Unknown error", authSession.accessToken).catch(() => {});
      }
    }
  }

  // "if it's engineering, all the engineers should receive the request" --
  // looks up everyone currently holding the role and fires the same
  // task_assigned notification to each of them individually, instead of
  // picking one person.
  async function notifyRoleAssignment(roleKey: string, title: string, taskId: string, taskTitle: string) {
    if (!authSession) {
      return;
    }
    const members = await loadUsersByRole(roleKey, authSession.accessToken).catch(() => []);
    for (const member of members) {
      await notify("task_assigned", member.email, title, `"${taskTitle}" was assigned to the ${roleLabelFor(roleKey)} team.`, "task", taskId, `task_assigned:${taskId}:${member.email}`);
    }
  }

  // Whoever a task is currently assigned to -- one person, or every member
  // of a role/group -- should hear about things that happen to it, not just
  // about being assigned in the first place. Used for task_status_changed;
  // reusable for any other future per-task event. Skips notifying whoever
  // just made the change themselves -- no one needs to be told about their
  // own edit.
  async function notifyCurrentTaskAssignees(task: EOTask, eventType: string, title: string, body: string, dedupeSuffix: string) {
    if (!authSession) {
      return;
    }
    const actingEmail = authSession.email?.toLowerCase() ?? "";
    // Date-scoped, same convention as task_overdue: at most one of these per
    // recipient per task per day, so a task flip-flopping between two
    // statuses several times in a row doesn't spam, but a genuine repeat
    // transition on a later day still notifies.
    const today = new Date().toISOString().slice(0, 10);
    if (task.assigneeEmail) {
      if (task.assigneeEmail.toLowerCase() !== actingEmail) {
        await notify(eventType, task.assigneeEmail, title, body, "task", task.id, `${eventType}:${task.id}:${task.assigneeEmail}:${dedupeSuffix}:${today}`);
      }
      return;
    }
    if (task.assignedRoleKey) {
      const members = await loadUsersByRole(task.assignedRoleKey, authSession.accessToken).catch(() => []);
      for (const member of members) {
        if (member.email.toLowerCase() !== actingEmail) {
          await notify(eventType, member.email, title, body, "task", task.id, `${eventType}:${task.id}:${member.email}:${dedupeSuffix}:${today}`);
        }
      }
    }
  }

  // Purchase request status change -> the person who requested it, plus the
  // whole Purchasing/Procurement team (they're the ones acting on it day to
  // day, not just the one requester). Per E: "Both."
  async function notifyPurchaseRequestStatusChanged(request: PurchaseRequest, newStatus: PurchaseRequest["status"]) {
    if (!authSession) {
      return;
    }
    const actingEmail = authSession.email?.toLowerCase() ?? "";
    const title = "Purchase request status changed";
    const body = `"${request.itemName}" (${request.requestNumber}) moved to ${newStatus}.`;
    const dedupeKey = (recipient: string) => `purchase_request_status_changed:${request.id}:${recipient}:${newStatus}`;
    if (request.requestedByEmail && request.requestedByEmail.toLowerCase() !== actingEmail) {
      await notify("purchase_request_status_changed", request.requestedByEmail, title, body, "purchase_request", request.id, dedupeKey(request.requestedByEmail));
    }
    const purchasingTeam = await loadUsersByRole("purchasing", authSession.accessToken).catch(() => []);
    for (const member of purchasingTeam) {
      if (member.email.toLowerCase() !== actingEmail && member.email.toLowerCase() !== request.requestedByEmail?.toLowerCase()) {
        await notify("purchase_request_status_changed", member.email, title, body, "purchase_request", request.id, dedupeKey(member.email));
      }
    }
  }

  // Build stage change -> the Warehouse team, who runs the physical
  // kitting/assembly/testing workflow. Per E: "a role."
  async function notifyBuildStageChanged(build: BuildTransaction, newStage: NonNullable<BuildTransaction["stage"]>) {
    if (!authSession) {
      return;
    }
    const actingEmail = authSession.email?.toLowerCase() ?? "";
    const stageLabel = newStage.charAt(0).toUpperCase() + newStage.slice(1);
    const warehouseTeam = await loadUsersByRole("warehouse", authSession.accessToken).catch(() => []);
    for (const member of warehouseTeam) {
      if (member.email.toLowerCase() !== actingEmail) {
        await notify(
          "build_stage_changed",
          member.email,
          "Build stage changed",
          `${build.buildNumber} (${build.equipmentName}) moved to ${stageLabel}.`,
          "build",
          build.id,
          `build_stage_changed:${build.id}:${member.email}:${newStage}`,
        );
      }
    }
  }

  // Low stock -> Purchasing, Warehouse, and every Admin. Per E: both
  // "Purchasing" and "Warehouse/Admin" were selected. Date-scoped dedupe
  // (like task_overdue) so a part sitting below its reorder point through
  // many small movements in one day only notifies once per person per item
  // per day, not on every single pull/adjustment.
  async function notifyLowStockReached(part: Part) {
    if (!authSession) {
      return;
    }
    const actingEmail = authSession.email?.toLowerCase() ?? "";
    const today = new Date().toISOString().slice(0, 10);
    const title = "Low stock reached";
    const body = `${part.name} (${part.ref}) is at ${part.stock}, at or below its reorder point of ${part.reorderPoint}.`;
    const [purchasingTeam, warehouseTeam, admins] = await Promise.all([
      loadUsersByRole("purchasing", authSession.accessToken).catch(() => []),
      loadUsersByRole("warehouse", authSession.accessToken).catch(() => []),
      loadAdminEmails(authSession.accessToken).catch(() => []),
    ]);
    const seen = new Set<string>();
    for (const recipient of [...purchasingTeam, ...warehouseTeam, ...admins]) {
      const email = recipient.email.toLowerCase();
      if (email === actingEmail || seen.has(email)) {
        continue;
      }
      seen.add(email);
      await notify("low_stock_reached", recipient.email, title, body, "inventory_item", part.ref, `low_stock_reached:${part.ref}:${email}:${today}`);
    }
  }

  async function handleMarkNotificationRead(id: string) {
    if (!authSession) {
      return;
    }
    setNotifications((current) => current.map((entry) => (entry.id === id ? { ...entry, isRead: true } : entry)));
    await markNotificationRead(id, authSession.accessToken).catch(() => {});
  }

  function handleNotificationClick(entry: NotificationItem) {
    handleMarkNotificationRead(entry.id);
    setNotificationsOpen(false);
    if (entry.relatedEntityType === "task" && entry.relatedEntityId) {
      setTaskFocus({ taskId: entry.relatedEntityId, token: Date.now() });
      navigateToView("tasks");
    }
  }

  async function handleMarkAllNotificationsRead() {
    if (!authSession || !authSession.email) {
      return;
    }
    setNotifications((current) => current.map((entry) => ({ ...entry, isRead: true })));
    await markAllNotificationsRead(authSession.email, authSession.accessToken).catch(() => {});
  }

  async function handleUpdateNotificationRule(id: string, patch: Partial<Pick<NotificationRule, "channels" | "isActive">>) {
    if (!authSession) {
      return;
    }
    try {
      const updated = await updateNotificationRule(id, patch, authSession.accessToken);
      setNotificationRules((current) => current.map((entry) => (entry.id === id ? updated : entry)));
    } catch {
      // Non-critical -- rule edit failures don't need a user-facing status line.
    }
  }

  // Daily-deduped overdue-task check: runs client-side whenever tasks load
  // or change, no cron/service key needed. Each overdue task fires at most
  // once per day per assignee thanks to the dedupe_key unique index.
  useEffect(() => {
    if (!authSession || tasks.length === 0 || notificationRules.length === 0 || !ruleActive("task_overdue", "in_app")) {
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    tasks
      .filter((task) => task.status !== "done" && task.dueDate && task.dueDate < today && task.assigneeEmail)
      .forEach((task) => {
        notify(
          "task_overdue",
          task.assigneeEmail,
          "Task overdue",
          `"${task.title}" was due ${task.dueDate}.`,
          "task",
          task.id,
          `task_overdue:${task.id}:${today}`,
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, notificationRules, authSession]);

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setStandardInstallTimes([]);
      setScheduleTemplates([]);
      setProposalTemplateSections([]);
      return;
    }
    loadStandardInstallTimes(authSession.accessToken).then(setStandardInstallTimes).catch(() => {});
    loadScheduleTemplates(authSession.accessToken).then(setScheduleTemplates).catch(() => {});
    loadProposalTemplateSections(authSession.accessToken).then(setProposalTemplateSections).catch(() => {});
  }, [authSession]);

  async function handleUpdateProposalTemplateSection(id: string, updates: Partial<{ title: string; body: string; sequenceOrder: number }>) {
    if (!authSession) {
      return;
    }
    const ok = await updateProposalTemplateSection(id, updates, authSession.accessToken);
    if (ok) {
      setProposalTemplateSections((current) =>
        current.map((section) =>
          section.id === id
            ? { ...section, ...updates, updatedAt: new Date().toISOString() }
            : section,
        ),
      );
    }
  }

  async function handleSaveStandardInstallTime(entry: Omit<StandardInstallTime, "id">) {
    if (!authSession) {
      return;
    }
    try {
      const saved = await upsertStandardInstallTime(entry, authSession.accessToken);
      setStandardInstallTimes((current) => {
        const withoutExisting = current.filter((item) => item.category !== saved.category);
        return [...withoutExisting, saved].sort((a, b) => a.category.localeCompare(b.category));
      });
    } catch (error) {
      setScheduleStatus(error instanceof Error ? error.message : "Could not save standard time.");
    }
  }

  async function handleCreateScheduleTemplate(name: string, description: string) {
    if (!authSession || !name.trim()) {
      return;
    }
    try {
      const created = await createScheduleTemplate(name.trim(), description, authSession.accessToken);
      setScheduleTemplates((current) => [...current, created]);
    } catch (error) {
      setScheduleStatus(error instanceof Error ? error.message : "Could not create template.");
    }
  }

  async function handleAddSchedulePhase(templateId: string, phase: Omit<import("./persistence").ScheduleTemplatePhase, "id" | "templateId">) {
    if (!authSession) {
      return;
    }
    try {
      const created = await addScheduleTemplatePhase(templateId, phase, authSession.accessToken);
      setScheduleTemplates((current) => current.map((template) => (template.id === templateId ? { ...template, phases: [...template.phases, created] } : template)));
    } catch (error) {
      setScheduleStatus(error instanceof Error ? error.message : "Could not add phase.");
    }
  }

  async function handleDeleteSchedulePhase(templateId: string, phaseId: string) {
    if (!authSession) {
      return;
    }
    await deleteScheduleTemplatePhase(phaseId, authSession.accessToken);
    setScheduleTemplates((current) => current.map((template) => (template.id === templateId ? { ...template, phases: template.phases.filter((phase) => phase.id !== phaseId) } : template)));
  }

  // Deterministic schedule generation: standard time (hours per unit for a
  // BOM category) x quantity of that category in the project's BOM, summed
  // per phase, sequenced by phase order into calendar due dates (assumes an
  // 8-hour work day, does not currently skip weekends -- a reasonable v1).
  // No AI call in this path at all, per E's decision to keep the actual
  // date math deterministic and auditable.
  function generateScheduleTasks(project: ProjectSite, template: ScheduleTemplate): Array<Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">> {
    const bomQtyByCategory = new Map<string, number>();
    project.bom.forEach((line) => {
      const part = inventoryItems.find((item) => item.name === line.item);
      const category = part?.category ?? "Base";
      bomQtyByCategory.set(category, (bomQtyByCategory.get(category) ?? 0) + line.qty);
    });

    let cumulativeHours = 0;
    const sortedPhases = [...template.phases].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    return sortedPhases.map((phase) => {
      let hours = phase.fixedHours ?? 0;
      if (phase.durationMode === "per_bom_unit" && phase.bomCategoryFilter) {
        const qty = bomQtyByCategory.get(phase.bomCategoryFilter) ?? 0;
        const standardTime = standardInstallTimes.find((entry) => entry.category === phase.bomCategoryFilter);
        hours = qty * (standardTime?.hoursPerUnit ?? 0);
      }
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + Math.ceil(cumulativeHours / 8));
      cumulativeHours += hours;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + Math.ceil(cumulativeHours / 8));
      return {
        title: `${phase.phaseName} - ${project.name}`,
        description: `Auto-generated from schedule template "${template.name}" (${hours.toFixed(1)} standard hours).`,
        section: "projects" as TaskSection,
        projectRef: project.ref,
        quoteId: "",
        isInternal: false,
        status: "to_do" as TaskStatus,
        priority: "normal" as TaskPriority,
        category: "",
        impactAreas: [],
        assigneeUserId: null,
        assigneeEmail: "",
        // Was previously stuffed into `category` (a free-text label) instead
        // of actually assigning the task -- meaning every schedule-generated
        // task landed unassigned and nobody was ever notified about it. This
        // is the field the "Role" column in Admin -> Schedule Templates
        // actually means.
        assignedRoleKey: phase.defaultRole || null,
        startDate: startDate.toISOString().slice(0, 10),
        dueDate: dueDate.toISOString().slice(0, 10),
      };
    });
  }

  async function handleGenerateSchedule(project: ProjectSite, templateId: string) {
    const template = scheduleTemplates.find((entry) => entry.id === templateId);
    if (!template || template.phases.length === 0) {
      setScheduleStatus("Pick a template with at least one phase first.");
      return;
    }
    const generatedTasks = generateScheduleTasks(project, template);
    for (const task of generatedTasks) {
      await handleCreateTask(task);
    }
    setScheduleStatus(`Generated ${generatedTasks.length} schedule tasks for ${project.name} from "${template.name}".`);
  }

  // Phase 11: Submittals. Reads/writes go straight to the new relational
  // tables (not the app_records blob) since resolveProjectId bridges the gap
  // until Phase 10's full app cutover happens.
  async function reloadSubmittals(projectName: string) {
    if (!authSession || !projectName) {
      setSubmittals([]);
      return;
    }
    const projectId = await resolveProjectId(projectName, authSession.accessToken);
    if (!projectId) {
      setSubmittals([]);
      return;
    }
    const rows = await loadSubmittalsForProject(projectId, authSession.accessToken);
    setSubmittals(rows);
  }

  async function handleCreateSubmittal(project: ProjectSite, clientName: string, clientEmail: string) {
    if (!authSession) {
      return;
    }
    setSubmittalStatus("Creating submittal...");
    try {
      const projectId = await resolveProjectId(project.name, authSession.accessToken);
      if (!projectId) {
        setSubmittalStatus("Could not resolve this project's database record.");
        return;
      }
      const existing = await loadSubmittalsForProject(projectId, authSession.accessToken);
      const nextVersion = existing.length ? Math.max(...existing.map((entry) => entry.version)) + 1 : 1;
      const snapshot: SubmittalSnapshot = {
        projectName: project.name,
        projectRef: project.ref,
        clientName: project.client,
        siteAddress: project.address,
        targetDate: project.due,
        allocated: project.allocated,
        sow: { ...project.sow },
        bom: project.bom.map((line) => ({ item: line.item, qty: line.qty, status: line.status })),
      };
      const created = await createSubmittal(
        { projectId, version: nextVersion, contentSnapshot: snapshot, clientName, clientEmail },
        authSession.accessToken,
      );
      const shareToken = await createSubmittalShareToken(created.id, authSession.accessToken);
      setSubmittals([{ ...created, shareToken }, ...existing]);

      if (!clientEmail.trim()) {
        setSubmittalStatus(`Submittal v${created.version} created. No client email was entered -- use Copy client link to share it.`);
        return;
      }

      setSubmittalStatus(`Submittal v${created.version} created. Sending email to ${clientEmail}...`);
      const shareUrl = `${window.location.origin}${window.location.pathname}?submittal=${shareToken}`;
      try {
        const emailResponse = await fetch("/api/send-submittal-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientEmail, clientName, projectName: project.name, projectRef: project.ref, shareUrl }),
        });
        const emailResult = (await emailResponse.json()) as { sent: boolean; reason?: string; error?: string };
        if (emailResult.sent) {
          setSubmittalStatus(`Submittal v${created.version} created and emailed to ${clientEmail}.`);
        } else {
          setSubmittalStatus(`Submittal v${created.version} created. ${emailResult.reason || emailResult.error || "Email was not sent."}`);
        }
      } catch (emailError) {
        setSubmittalStatus(`Submittal v${created.version} created, but the send request failed. Use Copy client link to share it manually.`);
      }
    } catch (error) {
      setSubmittalStatus(error instanceof Error ? error.message : "Could not create submittal.");
    }
  }

  // Migration 053: Quote Proposals. Same shape as Submittals above, just
  // sourced from a Sales Quote instead of a Project -- freeze a snapshot at
  // send time (BOM lines resolved against the catalog items they're linked
  // to, plus the current wording of the shared boilerplate sections), email
  // a share-token link, and let the client click Approve/Reject/Request
  // Revision on a public page with no login.
  function buildProposalSnapshot(quote: SalesQuote): ProposalSnapshot {
    return {
      clientName: quote.clientName,
      siteName: quote.siteName,
      city: quote.city,
      quoteRef: quote.id.slice(0, 8).toUpperCase(),
      proposalSummary: quote.proposalSummary,
      bom: quote.bomLines.map((line) => {
        const linked = line.catalogItemId ? catalogItems.find((item) => item.id === line.catalogItemId) : undefined;
        const datasheetUrl = linked
          ? linked.datasheetUrl || (linked.datasheetStoragePath ? getCatalogDatasheetPublicUrl(linked.datasheetStoragePath) ?? "" : "")
          : "";
        return {
          item: linked ? linked.productName : line.item,
          qty: line.qty,
          notes: line.notes,
          imageUrl: linked?.imageUrl ?? "",
          description: linked?.salesDescription ?? "",
          manufacturer: linked?.manufacturer ?? "",
          hasDatasheet: Boolean(datasheetUrl),
          datasheetUrl,
        };
      }),
      templateSections: proposalTemplateSections
        .slice()
        .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
        .map((section) => ({ title: section.title, body: section.body })),
    };
  }

  async function reloadQuoteProposals(quoteId: string) {
    if (!authSession || !quoteId) {
      setQuoteProposals([]);
      return;
    }
    const rows = await loadProposalsForQuote(quoteId, authSession.accessToken);
    setQuoteProposals(rows);
  }

  async function handleCreateQuoteProposal(quote: SalesQuote) {
    if (!authSession) {
      return;
    }
    if (!quote.clientEmail.trim()) {
      setQuoteProposalStatus("Enter a client email before creating a proposal.");
      return;
    }
    setQuoteProposalStatus("Creating proposal...");
    try {
      const existing = await loadProposalsForQuote(quote.id, authSession.accessToken);
      const nextVersion = existing.length ? Math.max(...existing.map((entry) => entry.version)) + 1 : 1;
      const snapshot = buildProposalSnapshot(quote);
      const created = await createQuoteProposal(
        { quoteId: quote.id, version: nextVersion, contentSnapshot: snapshot, clientName: quote.clientName, clientEmail: quote.clientEmail },
        authSession.accessToken,
      );
      const shareToken = await createQuoteProposalShareToken(created.id, authSession.accessToken);
      setQuoteProposals([{ ...created, shareToken }, ...existing]);

      setQuoteProposalStatus(`Proposal v${created.version} created. Sending email to ${quote.clientEmail}...`);
      const shareUrl = `${window.location.origin}${window.location.pathname}?proposal=${shareToken}`;
      try {
        const emailResponse = await fetch("/api/send-proposal-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientEmail: quote.clientEmail,
            clientName: quote.clientName,
            siteName: quote.siteName,
            quoteRef: snapshot.quoteRef,
            shareUrl,
          }),
        });
        const emailResult = (await emailResponse.json()) as { sent: boolean; reason?: string; error?: string };
        if (emailResult.sent) {
          setQuoteProposalStatus(`Proposal v${created.version} created and emailed to ${quote.clientEmail}.`);
        } else {
          setQuoteProposalStatus(`Proposal v${created.version} created. ${emailResult.reason || emailResult.error || "Email was not sent."}`);
        }
      } catch (emailError) {
        setQuoteProposalStatus(`Proposal v${created.version} created, but the send request failed. Use Copy client link to share it manually.`);
      }
    } catch (error) {
      setQuoteProposalStatus(error instanceof Error ? error.message : "Could not create proposal.");
    }
  }

  // Phase 18: fluid forms engine + After-Sales Handover. Loaded once per
  // auth session, same as schedule templates/standard times.
  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setHandoverSchema(null);
      setPresalesRules([]);
      setSiteHardwareRules([]);
      setTaskHardwareDependencies([]);
      return;
    }
    loadFormSchema("after_sales_handover", authSession.accessToken).then(setHandoverSchema).catch(() => {});
    loadFormSchema("sales_site_intake", authSession.accessToken).then(setSiteIntakeSchema).catch(() => {});
    loadPresalesRules(authSession.accessToken).then(setPresalesRules).catch(() => {});
    loadSiteHardwareRules(authSession.accessToken).then(setSiteHardwareRules).catch(() => {});
    loadTaskHardwareDependencies(authSession.accessToken).then(async (deps) => {
      setTaskHardwareDependencies(deps);
      const skuMap = await loadInventoryItemSkusByIds(deps.map((dep) => dep.inventoryItemId).filter((id): id is string => Boolean(id)), authSession.accessToken);
      setInventoryItemSkuById(skuMap);
    }).catch(() => {});
  }, [authSession]);

  async function handleAddFormField(field: Omit<FormSchemaField, "id" | "formSchemaId">) {
    if (!authSession || !handoverSchema) {
      return;
    }
    try {
      const created = await addFormSchemaField(handoverSchema.id, field, authSession.accessToken);
      setHandoverSchema((current) => (current ? { ...current, fields: [...current.fields, created].sort((a, b) => a.sequenceOrder - b.sequenceOrder) } : current));
    } catch (error) {
      setFormBuilderStatus(error instanceof Error ? error.message : "Could not add field.");
    }
  }

  async function handleUpdateFormField(id: string, patch: Partial<Omit<FormSchemaField, "id" | "formSchemaId">>) {
    if (!authSession) {
      return;
    }
    await updateFormSchemaField(id, patch, authSession.accessToken);
    setHandoverSchema((current) =>
      current ? { ...current, fields: current.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)).sort((a, b) => a.sequenceOrder - b.sequenceOrder) } : current,
    );
  }

  async function handleDeleteFormField(id: string) {
    if (!authSession) {
      return;
    }
    await deleteFormSchemaField(id, authSession.accessToken);
    setHandoverSchema((current) => (current ? { ...current, fields: current.fields.filter((field) => field.id !== id) } : current));
  }

  function handleReorderFormField(id: string, direction: "up" | "down") {
    if (!handoverSchema) {
      return;
    }
    const sorted = [...handoverSchema.fields].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    const index = sorted.findIndex((field) => field.id === id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
      return;
    }
    const a = sorted[index];
    const b = sorted[targetIndex];
    handleUpdateFormField(a.id, { sequenceOrder: b.sequenceOrder });
    handleUpdateFormField(b.id, { sequenceOrder: a.sequenceOrder });
  }

  async function handleAddSiteIntakeField(field: Omit<FormSchemaField, "id" | "formSchemaId">) {
    if (!authSession || !siteIntakeSchema) {
      return;
    }
    try {
      const created = await addFormSchemaField(siteIntakeSchema.id, field, authSession.accessToken);
      setSiteIntakeSchema((current) => (current ? { ...current, fields: [...current.fields, created].sort((a, b) => a.sequenceOrder - b.sequenceOrder) } : current));
    } catch (error) {
      setSiteIntakeFormBuilderStatus(error instanceof Error ? error.message : "Could not add field.");
    }
  }

  async function handleUpdateSiteIntakeField(id: string, patch: Partial<Omit<FormSchemaField, "id" | "formSchemaId">>) {
    if (!authSession) {
      return;
    }
    await updateFormSchemaField(id, patch, authSession.accessToken);
    setSiteIntakeSchema((current) =>
      current ? { ...current, fields: current.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)).sort((a, b) => a.sequenceOrder - b.sequenceOrder) } : current,
    );
  }

  async function handleDeleteSiteIntakeField(id: string) {
    if (!authSession) {
      return;
    }
    await deleteFormSchemaField(id, authSession.accessToken);
    setSiteIntakeSchema((current) => (current ? { ...current, fields: current.fields.filter((field) => field.id !== id) } : current));
  }

  function handleReorderSiteIntakeField(id: string, direction: "up" | "down") {
    if (!siteIntakeSchema) {
      return;
    }
    const sorted = [...siteIntakeSchema.fields].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    const index = sorted.findIndex((field) => field.id === id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
      return;
    }
    const a = sorted[index];
    const b = sorted[targetIndex];
    handleUpdateSiteIntakeField(a.id, { sequenceOrder: b.sequenceOrder });
    handleUpdateSiteIntakeField(b.id, { sequenceOrder: a.sequenceOrder });
  }

  async function reloadHandovers(projectName: string) {
    if (!authSession || !projectName) {
      setHandovers([]);
      return;
    }
    const projectId = await resolveProjectId(projectName, authSession.accessToken);
    if (!projectId) {
      setHandovers([]);
      return;
    }
    setHandovers(await loadHandoversForProject(projectId, authSession.accessToken));
  }

  async function handleCreateHandover(project: ProjectSite) {
    if (!authSession || !handoverSchema) {
      setHandoverStatus("Handover form isn't configured yet -- check Admin -> Form Builder.");
      return;
    }
    setHandoverStatus("Creating handover...");
    try {
      const projectId = await resolveProjectId(project.name, authSession.accessToken);
      if (!projectId) {
        setHandoverStatus("Could not resolve this project's database record.");
        return;
      }
      const created = await createHandover(projectId, handoverSchema.id, authSession.accessToken);
      setHandovers((current) => [created, ...current]);
      setHandoverStatus("Draft handover created -- fill it in below.");
    } catch (error) {
      setHandoverStatus(error instanceof Error ? error.message : "Could not create handover.");
    }
  }

  async function handleSaveHandoverResponses(handoverId: string, responses: Record<string, string>) {
    if (!authSession) {
      return;
    }
    await updateHandoverResponses(handoverId, responses, authSession.accessToken);
    setHandovers((current) => current.map((entry) => (entry.id === handoverId ? { ...entry, responses } : entry)));
  }

  async function handleSubmitHandover(handoverId: string) {
    if (!authSession) {
      return;
    }
    await submitHandover(handoverId, authSession.email, authSession.accessToken);
    setHandovers((current) =>
      current.map((entry) => (entry.id === handoverId ? { ...entry, status: "submitted", submittedByEmail: authSession.email, submittedAt: new Date().toISOString() } : entry)),
    );
    setHandoverStatus("Handover submitted.");
  }

  // Phase 20: pre-sales hardware rules engine. Evaluates the active rule set
  // against a category/node-count/cloud-sync questionnaire. Lives in Sales
  // now (moved off the Projects page -- Sales doesn't manage Projects), so
  // its output is written into a Sales Quote's persisted BOM instead of a
  // project's, via handleAddSalesQuoteBomLines below.
  function evaluatePresalesRules(tier: string, nodeCount: number, cloudSync: boolean) {
    return presalesRules
      .filter((rule) => rule.isActive && rule.tier === tier)
      .filter((rule) => rule.requiresCloudSync === null || rule.requiresCloudSync === cloudSync)
      .map((rule) => ({
        item: rule.baseItemName,
        qty: rule.quantityMode === "per_node_ceil" ? Math.max(1, Math.ceil(nodeCount / Math.max(1, rule.perNodeDivisor ?? 1))) : Math.round(rule.fixedQty),
      }));
  }

  async function handleGenerateBaselineBomForQuote(quoteId: string, tier: string, nodeCount: number, cloudSync: boolean) {
    const lines = evaluatePresalesRules(tier, nodeCount, cloudSync);
    if (lines.length === 0) {
      setPresalesStatus("No matching rules for that category -- add some in Admin -> Pre-Sales Rules.");
      return;
    }
    await handleAddSalesQuoteBomLines(
      quoteId,
      lines.map((line) => ({ item: line.item, qty: line.qty, notes: "Auto-generated from pre-sales rules." })),
    );
    setPresalesStatus(`Added ${lines.length} baseline line${lines.length === 1 ? "" : "s"} to the quote BOM.`);
  }

  async function handleAddPresalesRule(rule: Omit<PresalesHardwareRule, "id">) {
    if (!authSession) {
      return;
    }
    try {
      const created = await createPresalesRule(rule, authSession.accessToken);
      setPresalesRules((current) => [...current, created]);
    } catch (error) {
      setPresalesStatus(error instanceof Error ? error.message : "Could not add rule.");
    }
  }

  async function handleDeletePresalesRule(id: string) {
    if (!authSession) {
      return;
    }
    await deletePresalesRule(id, authSession.accessToken);
    setPresalesRules((current) => current.filter((rule) => rule.id !== id));
  }

  // "Pull BOM from Closed Sales" -- the other path onto a project's BOM
  // alongside the existing PDF-upload extraction (both stay available; the
  // goal is to move usage toward this one over time, not to replace the PDF
  // path outright). One-time copy, same as the PDF path: grabs the quote's
  // current BOM lines and drops them into the project as drafts -- editing
  // the quote afterward doesn't change the project. Returns how many lines
  // were pulled (0 = nothing to pull) so the caller can show its own status.
  function handlePullBomFromClosedQuote(projectRef: string, quoteId: string): number {
    const quote = salesQuotes.find((entry) => entry.id === quoteId);
    if (!quote || quote.bomLines.length === 0) {
      return 0;
    }
    setProjectSites((current) =>
      current.map((project) =>
        project.ref === projectRef
          ? {
              ...project,
              client: project.client || quote.clientName,
              address: project.address || quote.city,
              bom: [
                ...project.bom,
                ...quote.bomLines.map((line) => ({
                  item: line.item,
                  qty: line.qty,
                  status: "Not started" as BomLine["status"],
                  requestSpeed: "Standard" as BomLine["requestSpeed"],
                  notes: line.notes || `Pulled from closed quote "${quote.siteName}".`,
                  procurementTrack: "warehouse_stock" as BomLine["procurementTrack"],
                  sentToPurchasingAt: null,
                })),
              ],
            }
          : project,
      ),
    );
    return quote.bomLines.length;
  }

  async function handleAddSiteHardwareRule(rule: Omit<SiteHardwareRule, "id">) {
    if (!authSession) {
      return;
    }
    try {
      const created = await createSiteHardwareRule(rule, authSession.accessToken);
      setSiteHardwareRules((current) => [...current, created]);
    } catch (error) {
      setSiteHardwareRuleStatus(error instanceof Error ? error.message : "Could not add rule.");
    }
  }

  async function handleUpdateSiteHardwareRule(id: string, patch: Partial<Omit<SiteHardwareRule, "id">>) {
    if (!authSession) {
      return;
    }
    setSiteHardwareRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
    await updateSiteHardwareRule(id, patch, authSession.accessToken);
  }

  async function handleDeleteSiteHardwareRule(id: string) {
    if (!authSession) {
      return;
    }
    await deleteSiteHardwareRule(id, authSession.accessToken);
    setSiteHardwareRules((current) => current.filter((rule) => rule.id !== id));
  }

  // Phase 21: task-linked inventory automation. All client-side, sequential
  // REST calls -- no Edge Function, no service-role key. Reuses the same
  // blob-backed pullFromInventory/queueProjectBomPurchaseRequest paths every
  // other inventory/purchasing action in this app already goes through, so
  // this can't create a split-brain state between Postgres and the blob.
  async function handleAddTaskDependency(taskId: string, sku: string, quantityRequired: number) {
    if (!authSession) {
      return;
    }
    try {
      const inventoryItemId = await resolveInventoryItemIdBySku(sku, authSession.accessToken);
      if (!inventoryItemId) {
        setFormBuilderStatus(`"${sku}" hasn't synced to the database yet -- open Inventory once to sync it, then try again.`);
        return;
      }
      const created = await addTaskHardwareDependency({ taskId, projectBomLineId: null, inventoryItemId, quantityRequired }, authSession.accessToken);
      setTaskHardwareDependencies((current) => [...current, created]);
      setInventoryItemSkuById((current) => ({ ...current, [inventoryItemId]: sku }));
    } catch (error) {
      setFormBuilderStatus(error instanceof Error ? error.message : "Could not link hardware to task.");
    }
  }

  async function handleDeleteTaskDependency(id: string) {
    if (!authSession) {
      return;
    }
    await deleteTaskHardwareDependency(id, authSession.accessToken);
    setTaskHardwareDependencies((current) => current.filter((dep) => dep.id !== id));
  }

  async function runTaskHardwareAutomation(task: EOTask) {
    const pending = taskHardwareDependencies.filter((dep) => dep.taskId === task.id && dep.fulfillmentStatus === "pending");
    if (pending.length === 0 || !authSession) {
      return;
    }
    const project = projectSites.find((entry) => entry.ref === task.projectRef);
    for (const dep of pending) {
      const sku = dep.inventoryItemId ? inventoryItemSkuById[dep.inventoryItemId] : undefined;
      const part = sku ? inventoryItems.find((item) => item.ref === sku) : undefined;
      if (!part) {
        continue;
      }
      const note = `Auto-${part.stock >= dep.quantityRequired ? "reserved" : "queued"} for task ${task.taskNumber}.`;
      if (part.stock >= dep.quantityRequired) {
        pullFromInventory(part.name, dep.quantityRequired, project?.name, note);
        await updateTaskHardwareDependencyStatus(dep.id, "allocated", authSession.accessToken);
        setTaskHardwareDependencies((current) => current.map((entry) => (entry.id === dep.id ? { ...entry, fulfillmentStatus: "allocated" } : entry)));
      } else {
        await queueProjectBomPurchaseRequest(part.name, dep.quantityRequired, project?.name ?? "", task.projectRef, "Standard", note, "warehouse_stock");
        await updateTaskHardwareDependencyStatus(dep.id, "procurement_queued", authSession.accessToken);
        setTaskHardwareDependencies((current) => current.map((entry) => (entry.id === dep.id ? { ...entry, fulfillmentStatus: "procurement_queued" } : entry)));
      }
    }
  }

  useEffect(() => {
    if (!window.location.hash) {
      const savedHash = window.localStorage.getItem("ergon:lastHash") ?? "#dashboard";
      window.history.replaceState({ ergonView: viewFromHash(savedHash) }, "", savedHash);
      setView(viewFromHash(savedHash));
      setLocationHash(savedHash);
    }

    function handleHashChange() {
      setView(viewFromHash());
      setLocationHash(window.location.hash || "#dashboard");
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    const activeHash = locationHash || `#${view}`;
    const key = scrollKey(activeHash);
    const savedScroll = Number(window.localStorage.getItem(key) ?? 0);
    window.localStorage.setItem("ergon:lastHash", activeHash);
    const restoreTimer = window.setTimeout(() => window.scrollTo({ top: savedScroll, left: 0, behavior: "auto" }), 80);

    function saveScroll() {
      window.localStorage.setItem(scrollKey(activeHash), String(window.scrollY));
      window.localStorage.setItem("ergon:lastHash", activeHash);
    }

    window.addEventListener("scroll", saveScroll, { passive: true });
    window.addEventListener("beforeunload", saveScroll);
    document.addEventListener("visibilitychange", saveScroll);

    return () => {
      window.clearTimeout(restoreTimer);
      saveScroll();
      window.removeEventListener("scroll", saveScroll);
      window.removeEventListener("beforeunload", saveScroll);
      document.removeEventListener("visibilitychange", saveScroll);
    };
  }, [view, locationHash]);

  function navigateToView(nextView: View) {
    window.localStorage.setItem(scrollKey(), String(window.scrollY));
    window.location.hash = nextView;
    setAccountMenuOpen(false);
  }

  // Global top-nav search -- parts (Inventory), purchase orders (Reports'
  // Purchasing tab, which already has a real text filter), and projects
  // (Projects, which already supports deep-linking to a specific project via
  // #projects/<slug>). Capped at 5 per group; only searches once the query
  // is at least 2 characters so it doesn't flood the dropdown on every
  // keystroke of a 1-letter query.
  const globalSearchTerm = globalSearchQuery.trim().toLowerCase();
  const globalSearchMatches =
    globalSearchTerm.length < 2
      ? { parts: [] as Part[], orders: [] as PurchaseOrder[], projects: [] as ProjectSite[] }
      : {
          parts: inventoryItems
            .filter((part) => `${part.ref} ${part.name} ${part.description} ${part.manufacturer} ${part.category}`.toLowerCase().includes(globalSearchTerm))
            .slice(0, 5),
          orders: purchaseOrders
            .filter((order) => `${order.number} ${order.vendor} ${order.projectRef} ${order.sourceFile ?? ""}`.toLowerCase().includes(globalSearchTerm))
            .slice(0, 5),
          projects: projectSites
            .filter((project) => `${project.name} ${project.ref} ${project.client}`.toLowerCase().includes(globalSearchTerm))
            .slice(0, 5),
        };

  function closeGlobalSearch() {
    setGlobalSearchQuery("");
    setGlobalSearchOpen(false);
  }

  function handleSelectSearchProject(project: ProjectSite) {
    window.location.hash = `projects/${projectSlug(project.name)}`;
    closeGlobalSearch();
  }

  function handleSelectSearchPart(part: Part) {
    setInventorySearchFocus({ term: part.ref, token: Date.now() });
    navigateToView("inventory");
    closeGlobalSearch();
  }

  function handleSelectSearchOrder(order: PurchaseOrder) {
    setReportsSearchFocus({ term: order.number, token: Date.now() });
    navigateToView("reports");
    closeGlobalSearch();
  }

  function pullFromInventory(itemName: string, qty: number, projectName?: string, notes?: string) {
    const part = inventoryItems.find((item) => item.name === itemName);
    const pullQty = Math.max(1, Math.round(Number(qty) || 1));
    if (!part || part.retired || part.stock < pullQty) {
      return;
    }

    const pulledAt = new Date().toISOString();
    const movement: InventoryMovement = {
      id: makeId("txn"),
      type: "transfer",
      sku: part.ref,
      itemName: part.name,
      quantity: pullQty,
      quantityBefore: part.stock,
      quantityAfter: part.stock - pullQty,
      projectName,
      source: "project",
      notes: notes || `Pulled from inventory for ${projectName ?? "project BOM"}.`,
      createdAt: pulledAt,
    };

    setInventoryItems((current) => current.map((item) => (item.ref === part.ref ? { ...item, stock: item.stock - pullQty } : item)));
    recordMovements([movement]);
    if (movement.quantityAfter <= part.reorderPoint) {
      notifyLowStockReached({ ...part, stock: movement.quantityAfter });
    }

    if (projectName) {
      setProjectAllocations((current) => [
        {
          id: makeId("alloc"),
          projectName,
          projectRef: projectSites.find((project) => project.name === projectName)?.ref,
          sku: part.ref,
          itemName: part.name,
          quantity: pullQty,
          movementId: movement.id,
          action: "allocated",
          notes: notes || "Pulled from inventory through project BOM.",
          createdAt: pulledAt,
        },
        ...current,
      ]);
    }
  }

  function withProductionLock(lockType: "inventory_item" | "project" | "build" | "purchase_request", lockKey: string, action: () => void) {
    if (!isRemotePersistenceConfigured() || !authSession) {
      action();
      return;
    }

    void (async () => {
      let lockId: string | null = null;
      try {
        lockId = await acquireTransactionLock(lockType, lockKey, authSession.accessToken);
        action();
      } catch (error) {
        setSyncStatus("error");
        setAuthStatus(error instanceof Error ? error.message : "Record is locked for another operation.");
      } finally {
        await releaseTransactionLock(lockId, authSession.accessToken);
      }
    })();
  }

  // Every inventory movement gets stamped with who made it here, in one
  // place, instead of at each of the ~9 call sites that create movements
  // -- so the ledger can show "by <email>" without relying on every
  // future call site remembering to set it too.
  function recordMovements(entries: InventoryMovement[]) {
    const stamped = entries.map((entry) => ({ ...entry, createdByEmail: authSession?.email ?? "" }));
    setInventoryMovements((current) => [...stamped, ...current]);
  }

  function addInventoryItem(part: Part) {
    withProductionLock("inventory_item", part.ref, () => {
    setInventoryItems((current) => [part, ...current]);
    const movement: InventoryMovement = {
      id: makeId("txn"),
      type: "receive",
      sku: part.ref,
      itemName: part.name,
      quantity: part.stock,
      quantityBefore: 0,
      quantityAfter: part.stock,
      source: "inventory",
      notes: "New SKU created in inventory.",
      createdAt: new Date().toISOString(),
    };
    recordMovements([movement]);
    });
  }

  function updateInventoryItem(ref: string, nextPart: Part) {
    withProductionLock("inventory_item", ref, () => {
    const previousPart = inventoryItems.find((part) => part.ref === ref);
    setInventoryItems((current) => current.map((part) => (part.ref === ref ? nextPart : part)));
    if (!previousPart) {
      return;
    }

    const movements: InventoryMovement[] = [];
    if (previousPart.stock !== nextPart.stock) {
      movements.push({
        id: makeId("txn"),
        type: "adjust",
        sku: nextPart.ref,
        itemName: nextPart.name,
        quantity: Math.abs(nextPart.stock - previousPart.stock),
        quantityBefore: previousPart.stock,
        quantityAfter: nextPart.stock,
        source: "inventory",
        notes: "Manual stock adjustment from item edit.",
        createdAt: new Date().toISOString(),
      });
    }
    if ((previousPart.retired ?? false) !== (nextPart.retired ?? false)) {
      movements.push({
        id: makeId("txn"),
        type: nextPart.retired ? "retire" : "reactivate",
        sku: nextPart.ref,
        itemName: nextPart.name,
        quantity: 0,
        quantityBefore: previousPart.stock,
        quantityAfter: nextPart.stock,
        source: "inventory",
        notes: nextPart.retired ? "Inventory item retired." : "Inventory item reactivated.",
        createdAt: new Date().toISOString(),
      });
    }
    if (movements.length) {
      recordMovements(movements);
    }
    });
  }

  function receiveInventoryStock(partRef: string, qty: number, unitCost: number, poNumber: string, notes: string) {
    withProductionLock("inventory_item", partRef, () => {
    const part = inventoryItems.find((item) => item.ref === partRef);
    const receiveQty = Math.max(1, Math.round(Number(qty) || 1));
    if (!part || part.retired) {
      return;
    }

    const receivedAt = new Date().toISOString();
    const nextCost = unitCost > 0 ? unitCost : part.cost;
    const movement: InventoryMovement = {
      id: makeId("txn"),
      type: "receive",
      sku: part.ref,
      itemName: part.name,
      quantity: receiveQty,
      quantityBefore: part.stock,
      quantityAfter: part.stock + receiveQty,
      poNumber: poNumber.trim() || undefined,
      source: "purchasing",
      notes: notes.trim() || "Received stock into inventory.",
      createdAt: receivedAt,
    };

    setInventoryItems((current) =>
      current.map((item) =>
        item.ref === partRef
          ? {
              ...item,
              cost: nextCost,
              stock: item.stock + receiveQty,
              priceHistory:
                unitCost > 0
                  ? [
                      ...(item.priceHistory ?? []),
                      {
                        id: Date.now(),
                        date: receivedAt.slice(0, 10),
                        vendor: poNumber.trim() || "Received stock",
                        unitCost: nextCost,
                        notes: notes.trim() || "Stock receipt.",
                      },
                    ]
                  : item.priceHistory,
            }
          : item,
      ),
    );
    recordMovements([movement]);
    });
  }

  function adjustInventoryStock(partRef: string, nextQty: number, notes: string) {
    withProductionLock("inventory_item", partRef, () => {
    const part = inventoryItems.find((item) => item.ref === partRef);
    const adjustedQty = Math.max(0, Math.round(Number(nextQty) || 0));
    if (!part || part.retired || adjustedQty === part.stock) {
      return;
    }

    const movement: InventoryMovement = {
      id: makeId("txn"),
      type: "adjust",
      sku: part.ref,
      itemName: part.name,
      quantity: Math.abs(adjustedQty - part.stock),
      quantityBefore: part.stock,
      quantityAfter: adjustedQty,
      source: "inventory",
      notes: notes.trim() || "Cycle count adjustment.",
      createdAt: new Date().toISOString(),
    };
    setInventoryItems((current) => current.map((item) => (item.ref === partRef ? { ...item, stock: adjustedQty } : item)));
    recordMovements([movement]);
    if (adjustedQty <= part.reorderPoint) {
      notifyLowStockReached({ ...part, stock: adjustedQty });
    }
    });
  }

  function transferInventoryToProject(partRef: string, projectName: string, qty: number, notes: string) {
    withProductionLock("inventory_item", partRef, () => {
    const part = inventoryItems.find((item) => item.ref === partRef);
    if (!part || part.stock <= 0) {
      return;
    }

    const transferQty = Math.min(Math.max(1, qty), part.stock);
    const movement: InventoryMovement = {
      id: makeId("txn"),
      type: "transfer",
      sku: part.ref,
      itemName: part.name,
      quantity: transferQty,
      quantityBefore: part.stock,
      quantityAfter: part.stock - transferQty,
      projectName,
      source: "project",
      notes: notes || `Transferred from SKU ${part.ref}.`,
      createdAt: new Date().toISOString(),
    };
    setInventoryItems((current) => current.map((item) => (item.ref === partRef ? { ...item, stock: item.stock - transferQty } : item)));
    recordMovements([movement]);
    if (movement.quantityAfter <= part.reorderPoint) {
      notifyLowStockReached({ ...part, stock: movement.quantityAfter });
    }
    setProjectAllocations((current) => [
      {
        id: makeId("alloc"),
        projectName,
        projectRef: projectSites.find((project) => project.name === projectName)?.ref,
        sku: part.ref,
        itemName: part.name,
        quantity: transferQty,
        movementId: movement.id,
        action: "allocated",
        notes: notes || "Inventory transferred to project.",
        createdAt: movement.createdAt,
      },
      ...current,
    ]);
    setProjectSites((current) =>
      current.map((project) =>
        project.name === projectName
          ? {
              ...project,
              bom: [
                ...project.bom,
                {
                  item: part.name,
                  qty: transferQty,
                  status: "From Inventory",
                  requestSpeed: "Standard",
                  notes: notes || `Transferred from SKU ${part.ref}.`,
                },
              ],
            }
          : project,
      ),
    );
    });
  }

  function planBuildTransaction(recipe: BuildRecipe, qty: number) {
    const buildQty = Math.max(1, Math.round(Number(qty) || 1));
    if (recipe.retired || recipe.components.length === 0) {
      return;
    }

    const plannedAt = new Date().toISOString();
    const transaction: BuildTransaction = {
      id: makeId("build"),
      buildNumber: buildNumber(buildTransactions.length),
      equipmentName: recipe.outputName,
      quantityBuilt: buildQty,
      componentMovements: [],
      status: "planned",
      stage: "planned",
      createdAt: plannedAt,
    };
    setBuildTransactions((current) => [transaction, ...current]);
  }

  function buildInventoryUnit(recipe: BuildRecipe, qty: number, plannedBuildId?: string) {
    withProductionLock("build", plannedBuildId ?? recipe.name, () => {
    const buildQty = Math.max(1, Math.round(Number(qty) || 1));
    const plannedBuild = plannedBuildId ? buildTransactions.find((build) => build.id === plannedBuildId && build.status === "planned") : undefined;
    const hasShortage = recipe.components.some((component) => {
      const part = inventoryItems.find((item) => item.name === component.itemName);
      return !part || part.stock < component.qty * buildQty;
    });

    if (hasShortage) {
      return;
    }

    const postedAt = new Date().toISOString();
    const nextBuildNumber = plannedBuild?.buildNumber ?? buildNumber(buildTransactions.length);
    const componentMovements = recipe.components.map((component) => {
      const part = inventoryItems.find((item) => item.name === component.itemName);
      const usedQty = component.qty * buildQty;
      return {
        id: makeId("txn"),
        type: "build_consume" as const,
        sku: part?.ref ?? "NO-SKU",
        itemName: component.itemName,
        quantity: usedQty,
        quantityBefore: part?.stock ?? 0,
        quantityAfter: Math.max(0, (part?.stock ?? 0) - usedQty),
        buildNumber: nextBuildNumber,
        source: "equipment" as const,
        notes: `Consumed for ${recipe.outputName}.`,
        createdAt: postedAt,
      };
    });
    let completionMovement: InventoryMovement | null = null;

    for (const movement of componentMovements) {
      const part = inventoryItems.find((item) => item.ref === movement.sku);
      if (part && movement.quantityAfter <= part.reorderPoint) {
        notifyLowStockReached({ ...part, stock: movement.quantityAfter });
      }
    }

    setInventoryItems((current) => {
      const consumed = current.map((part) => {
        const component = recipe.components.find((item) => item.itemName === part.name);
        return component ? { ...part, stock: Math.max(0, part.stock - component.qty * buildQty) } : part;
      });
      const existingBuild = consumed.find((part) => part.name === recipe.outputName);
      const buildCost = recipe.components.reduce((sum, component) => {
        const part = current.find((item) => item.name === component.itemName);
        return sum + (part?.cost ?? 0) * component.qty;
      }, 0);

      if (existingBuild) {
        completionMovement = {
          id: makeId("txn"),
          type: "build_complete",
          sku: existingBuild.ref,
          itemName: recipe.outputName,
          quantity: buildQty,
          quantityBefore: existingBuild.stock,
          quantityAfter: existingBuild.stock + buildQty,
          buildNumber: nextBuildNumber,
          source: "equipment",
          notes: `Completed ${recipe.outputName}.`,
          createdAt: postedAt,
        };
        return consumed.map((part) => (part.ref === existingBuild.ref ? { ...part, stock: part.stock + buildQty, cost: buildCost } : part));
      }

      const newBuildRef = nextBuildRef(consumed);
      completionMovement = {
        id: makeId("txn"),
        type: "build_complete",
        sku: newBuildRef,
        itemName: recipe.outputName,
        quantity: buildQty,
        quantityBefore: 0,
        quantityAfter: buildQty,
        buildNumber: nextBuildNumber,
        source: "equipment",
        notes: `Completed ${recipe.outputName}.`,
        createdAt: postedAt,
      };

      return [
        {
          ref: newBuildRef,
          name: recipe.outputName,
          description: recipe.description,
          manufacturer: "Internal Build",
          category: "Build",
          cost: buildCost,
          stock: buildQty,
          reorderPoint: 1,
          imageUrl: recipe.imageUrl ?? "",
          purchaseUrls: [],
          tags: ["VPU Part"],
          priceHistory: [
            {
              id: Date.now(),
              date: new Date().toISOString().slice(0, 10),
              vendor: "Internal Build",
              unitCost: buildCost,
              notes: `Built from ${recipe.components.length} component lines.`,
            },
          ],
        },
        ...consumed,
      ];
    });
    window.setTimeout(() => {
      if (!completionMovement) {
        return;
      }
      const transaction: BuildTransaction = {
        id: plannedBuild?.id ?? makeId("build"),
        buildNumber: nextBuildNumber,
        equipmentName: recipe.outputName,
        quantityBuilt: buildQty,
        componentMovements,
        completionMovement,
        status: "posted",
        stage: "complete",
        createdAt: postedAt,
      };
      recordMovements([completionMovement as InventoryMovement, ...componentMovements]);
      setBuildTransactions((current) => (plannedBuild ? current.map((build) => (build.id === plannedBuild.id ? transaction : build)) : [transaction, ...current]));
    }, 0);
    });
  }

  function undoBuildTransaction(buildId: string) {
    withProductionLock("build", buildId, () => {
    const transaction = buildTransactions.find((build) => build.id === buildId);
    if (!transaction || transaction.status !== "posted" || !transaction.completionMovement) {
      return;
    }

    const completionMovement = transaction.completionMovement;
    const undoneAt = new Date().toISOString();
    setInventoryItems((current) =>
      current.map((part) => {
        const consumed = transaction.componentMovements.find((movement) => movement.sku === part.ref || movement.itemName === part.name);
        if (consumed) {
          return { ...part, stock: part.stock + consumed.quantity };
        }
        if (part.ref === completionMovement.sku || part.name === completionMovement.itemName) {
          return { ...part, stock: Math.max(0, part.stock - completionMovement.quantity) };
        }
        return part;
      }),
    );

    const undoMovements: InventoryMovement[] = [
      {
        ...completionMovement,
        id: makeId("txn"),
        type: "undo",
        quantityBefore: completionMovement.quantityAfter,
        quantityAfter: completionMovement.quantityBefore,
        notes: `Undo build completion for ${transaction.buildNumber}.`,
        createdAt: undoneAt,
      },
      ...transaction.componentMovements.map((movement) => ({
        ...movement,
        id: makeId("txn"),
        type: "undo" as const,
        quantityBefore: movement.quantityAfter,
        quantityAfter: movement.quantityBefore,
        notes: `Undo component consumption for ${transaction.buildNumber}.`,
        createdAt: undoneAt,
      })),
    ];
    recordMovements(undoMovements);
    setBuildTransactions((current) => current.map((build) => (build.id === buildId ? { ...build, status: "undone", undoneAt } : build)));
    });
  }

  function updateBuildStage(buildId: string, stage: NonNullable<BuildTransaction["stage"]>) {
    const previous = buildTransactions.find((build) => build.id === buildId);
    setBuildTransactions((current) => current.map((build) => (build.id === buildId ? { ...build, stage } : build)));
    if (previous && previous.stage !== stage) {
      notifyBuildStageChanged({ ...previous, stage }, stage);
    }
  }

  function cancelPlannedBuild(buildId: string) {
    setBuildTransactions((current) =>
      current.map((build) =>
        build.id === buildId && build.status === "planned"
          ? {
              ...build,
              status: "cancelled",
              stage: "planned",
              undoneAt: new Date().toISOString(),
            }
          : build,
      ),
    );
  }

  // Phase 10a: all of the functions below write through to the real
  // `purchase_requests` table via persistence.ts, then mirror the change
  // into local state (and purchaseRequestsRef, kept in sync alongside it so
  // dedupe logic always reads fresh data even mid-loop, ahead of React's
  // render cycle). See the note by purchaseRequestsRef's declaration above.
  async function queuePurchaseRequest(
    part: Part,
    quantity: number,
    reason: PurchaseRequest["reason"],
    notes: string,
    sourceRef?: string,
    projectName?: string,
    procurementTrack: PurchaseRequest["procurementTrack"] = "warehouse_stock",
  ) {
    if (part.retired || !authSession) {
      return;
    }

    const requestQty = Math.max(1, Math.round(Number(quantity) || 1));
    const openStatuses: PurchaseRequest["status"][] = ["Draft", "Need Quote", "Ready to Order", "Ordered"];
    const current = purchaseRequestsRef.current;
    const matchingOpen = current.find(
      (request) =>
        request.sku === part.ref &&
        request.reason === reason &&
        request.sourceRef === sourceRef &&
        request.projectName === projectName &&
        (request.procurementTrack ?? "warehouse_stock") === procurementTrack &&
        openStatuses.includes(request.status),
    );

    if (matchingOpen) {
      const nextQuantity = Math.max(matchingOpen.quantity, requestQty);
      const nextNotes = notes || matchingOpen.notes;
      const next = current.map((request) =>
        request.id === matchingOpen.id ? { ...request, quantity: nextQuantity, notes: nextNotes } : request,
      );
      purchaseRequestsRef.current = next;
      setPurchaseRequests(next);
      try {
        await updatePurchaseRequestRemote(matchingOpen.id, { quantity: nextQuantity, notes: nextNotes }, authSession.accessToken);
      } catch {
        setSyncStatus("error");
      }
      return;
    }

    try {
      const created = await createPurchaseRequestRemote(
        {
          requestNumber: purchaseRequestNumber(current.length),
          sku: part.ref,
          itemName: part.name,
          quantity: requestQty,
          reason,
          sourceRef,
          projectName,
          procurementTrack,
          preferredVendor: (part.purchaseUrls ?? [])[0]?.label || part.manufacturer,
          estimatedUnitCost: part.cost,
          status: reason === "Manual" ? "Draft" : "Need Quote",
          notes,
          requestedByEmail: authSession.email,
        },
        authSession.accessToken,
      );
      if (created) {
        const next = [created, ...purchaseRequestsRef.current];
        purchaseRequestsRef.current = next;
        setPurchaseRequests(next);
      }
    } catch {
      setSyncStatus("error");
    }
  }

  async function queueReorderRequests() {
    for (const part of lowStock) {
      const qty = Math.max(1, part.reorderPoint - part.stock);
      await queuePurchaseRequest(part, qty, "Reorder Point", `Stock is ${part.stock}; reorder point is ${part.reorderPoint}.`);
    }
  }

  async function queuePlannedBuildShortageRequests() {
    for (const build of buildTransactions.filter((build) => build.status === "planned")) {
      await queueBuildShortageRequests(build.id);
    }
  }

  async function queueBuildShortageRequests(buildId: string) {
    const build = buildTransactions.find((item) => item.id === buildId);
    if (!build || build.status !== "planned") {
      return;
    }

    const recipe = deviceRecipes.find((item) => item.outputName === build.equipmentName || item.name === build.equipmentName);
    if (!recipe) {
      return;
    }
    for (const component of recipe.components) {
      const part = inventoryItems.find((item) => item.name === component.itemName);
      if (!part || part.retired) {
        continue;
      }
      const required = component.qty * build.quantityBuilt;
      const shortage = Math.max(0, required - part.stock);
      if (shortage > 0) {
        await queuePurchaseRequest(part, shortage, "Planned Build Shortage", `${build.buildNumber} needs ${required}; inventory has ${part.stock}.`, build.buildNumber);
      }
    }
  }

  async function queueManualPurchaseRequest(partRef: string, quantity: number, notes: string, projectName?: string, procurementTrack: PurchaseRequest["procurementTrack"] = "warehouse_stock") {
    const part = inventoryItems.find((item) => item.ref === partRef);
    if (!part) {
      return;
    }
    await queuePurchaseRequest(part, quantity, "Manual", notes.trim() || "Manual purchasing request.", projectName ? "Manual project request" : undefined, projectName, procurementTrack);
  }

  async function queueProjectBomPurchaseRequest(partName: string, quantity: number, projectName: string, projectRef: string, requestSpeed: BomLine["requestSpeed"], notes: string, procurementTrack: PurchaseRequest["procurementTrack"]) {
    const part = inventoryItems.find((item) => item.name === partName || item.ref === partName);
    if (!part) {
      return false;
    }
    const trackNote = procurementTrack === "direct_to_project" ? "Direct-to-project purchase" : "Warehouse stock purchase request";
    await queuePurchaseRequest(part, quantity, "Project BOM", notes.trim() || `${trackNote} from ${projectRef} BOM. Request speed: ${requestSpeed}.`, projectRef, projectName, procurementTrack);
    return true;
  }

  async function updatePurchaseRequestStatus(requestId: string, status: PurchaseRequest["status"]) {
    const existing = purchaseRequestsRef.current.find((request) => request.id === requestId);
    const next = purchaseRequestsRef.current.map((request) => (request.id === requestId ? { ...request, status } : request));
    purchaseRequestsRef.current = next;
    setPurchaseRequests(next);
    if (authSession) {
      await updatePurchaseRequestRemote(requestId, { status }, authSession.accessToken);
    }
    if (existing && existing.status !== status) {
      notifyPurchaseRequestStatusChanged({ ...existing, status }, status);
    }
  }

  async function updatePurchaseRequest(requestId: string, updates: Partial<Pick<PurchaseRequest, "quantity" | "preferredVendor" | "poNumber" | "expectedDate" | "estimatedUnitCost" | "status" | "notes" | "procurementTrack" | "projectName">>) {
    const current = purchaseRequestsRef.current;
    const existing = current.find((request) => request.id === requestId);
    if (!existing) {
      return;
    }
    const nextQuantity = updates.quantity !== undefined ? Math.max(existing.receivedQuantity ?? 0, Math.max(1, Math.round(Number(updates.quantity) || 1))) : existing.quantity;
    const nextPreferredVendor = updates.preferredVendor?.trim() || existing.preferredVendor;
    const nextPoNumber = updates.poNumber?.trim() ?? existing.poNumber;
    const nextExpectedDate = updates.expectedDate ?? existing.expectedDate;
    const nextEstimatedUnitCost = updates.estimatedUnitCost !== undefined ? Math.max(0, Number(updates.estimatedUnitCost) || 0) : existing.estimatedUnitCost;
    const nextProjectName = updates.projectName !== undefined ? updates.projectName || undefined : existing.projectName;
    const nextProcurementTrack = updates.procurementTrack ?? existing.procurementTrack;
    const nextNotes = updates.notes !== undefined ? updates.notes.trim() : existing.notes;
    const nextStatus = updates.status ?? existing.status;
    const next = current.map((request) =>
      request.id === requestId
        ? {
            ...request,
            quantity: nextQuantity,
            preferredVendor: nextPreferredVendor,
            poNumber: nextPoNumber,
            expectedDate: nextExpectedDate,
            estimatedUnitCost: nextEstimatedUnitCost,
            projectName: nextProjectName,
            procurementTrack: nextProcurementTrack,
            notes: nextNotes,
            status: nextStatus,
          }
        : request,
    );
    purchaseRequestsRef.current = next;
    setPurchaseRequests(next);
    if (authSession) {
      await updatePurchaseRequestRemote(
        requestId,
        {
          quantity: nextQuantity,
          preferredVendor: nextPreferredVendor,
          poNumber: nextPoNumber ?? null,
          expectedDate: nextExpectedDate ?? null,
          estimatedUnitCost: nextEstimatedUnitCost,
          status: nextStatus,
          notes: nextNotes,
          procurementTrack: nextProcurementTrack,
          projectName: nextProjectName ?? null,
        },
        authSession.accessToken,
      );
    }
    if (existing.status !== nextStatus) {
      notifyPurchaseRequestStatusChanged({ ...existing, status: nextStatus }, nextStatus);
    }
  }

  async function cancelPurchaseRequest(requestId: string) {
    await updatePurchaseRequestStatus(requestId, "Cancelled");
  }

  async function receivePurchaseRequest(requestId: string, quantityReceived: number, unitCost: number, notes: string) {
    const request = purchaseRequestsRef.current.find((item) => item.id === requestId);
    if (!request || request.status === "Received" || request.status === "Cancelled") {
      return;
    }
    const alreadyReceived = request.receivedQuantity ?? 0;
    const remaining = Math.max(0, request.quantity - alreadyReceived);
    const receiveQty = Math.min(remaining, Math.max(1, Math.round(Number(quantityReceived) || 1)));
    if (receiveQty <= 0) {
      return;
    }

    const effectiveUnitCost = Math.max(0, Number(unitCost) || request.estimatedUnitCost);
    if ((request.procurementTrack ?? "warehouse_stock") === "direct_to_project" && request.projectName) {
      const receivedAt = new Date().toISOString();
      const movement: InventoryMovement = {
        id: makeId("txn"),
        type: "receive",
        sku: request.sku,
        itemName: request.itemName,
        quantity: receiveQty,
        quantityBefore: 0,
        quantityAfter: 0,
        projectName: request.projectName,
        poNumber: request.poNumber || request.requestNumber,
        source: "purchasing",
        notes: notes || request.notes || "Direct-to-project receipt. Quantity was not added to warehouse stock.",
        createdAt: receivedAt,
      };
      recordMovements([movement]);
      setProjectAllocations((current) => [
        {
          id: makeId("alloc"),
          projectName: request.projectName ?? "",
          projectRef: projectSites.find((project) => project.name === request.projectName)?.ref ?? request.sourceRef,
          sku: request.sku,
          itemName: request.itemName,
          quantity: receiveQty,
          movementId: movement.id,
          action: "allocated",
          notes: `Direct-to-project receipt from ${request.requestNumber}.`,
          createdAt: receivedAt,
        },
        ...current,
      ]);
    } else {
      receiveInventoryStock(request.sku, receiveQty, effectiveUnitCost, request.poNumber || request.requestNumber, notes || request.notes || "Received from purchase request.");
    }
    const nextReceived = alreadyReceived + receiveQty;
    const nextStatus: PurchaseRequest["status"] = nextReceived >= request.quantity ? "Received" : "Ordered";
    const nextList = purchaseRequestsRef.current.map((item) =>
      item.id === request.id
        ? {
            ...item,
            receivedQuantity: nextReceived,
            estimatedUnitCost: effectiveUnitCost,
            status: nextStatus,
          }
        : item,
    );
    purchaseRequestsRef.current = nextList;
    setPurchaseRequests(nextList);
    if (authSession) {
      await updatePurchaseRequestRemote(
        request.id,
        { receivedQuantity: nextReceived, estimatedUnitCost: effectiveUnitCost, status: nextStatus },
        authSession.accessToken,
      );
    }
    if (request.status !== nextStatus) {
      notifyPurchaseRequestStatusChanged({ ...request, receivedQuantity: nextReceived, status: nextStatus }, nextStatus);
    }
  }

  function currentPersistedState(): PersistedAppState {
    return {
      roleMode,
    };
  }

  // Export/Import Backup pull a real snapshot of every entity from its own
  // table (not just the roleMode sliver left in the app_records blob) --
  // see loadFullBackupSnapshot/restoreFullBackupSnapshot in persistence.ts
  // for why, and why restore merges by natural key rather than wiping
  // anything that exists now but isn't in the file.
  async function exportBackup() {
    if (!authSession) {
      setAuthStatus("Sign in before exporting a backup.");
      return;
    }
    setAuthStatus("Building backup snapshot...");
    try {
      const snapshot = await loadFullBackupSnapshot(roleMode, authSession.accessToken);
      if (!snapshot) {
        setAuthStatus("Could not build a backup snapshot.");
        return;
      }
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ergon-ops-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setAuthStatus("Backup downloaded.");
    } catch {
      setAuthStatus("Backup export failed.");
    }
  }

  function importBackup(file: File | undefined) {
    if (!file || !authSession) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        try {
          const snapshot = JSON.parse(String(reader.result ?? "{}")) as Partial<FullBackupSnapshot>;
          if (["warehouse", "purchasing", "pm", "manager"].includes(String(snapshot.roleMode))) {
            setRoleMode(snapshot.roleMode as RoleMode);
          }
          setAuthStatus("Restoring backup -- this can take a moment for larger snapshots...");
          await restoreFullBackupSnapshot(snapshot, authSession.accessToken);
          // Reload every entity from the tables so the UI reflects the
          // merged result rather than the raw (possibly stale) file contents.
          const [
            reloadedProjectSites,
            reloadedInventoryItems,
            reloadedDeviceRecipes,
            reloadedPurchaseRequests,
            reloadedProjectDocuments,
            reloadedBuildTransactions,
            reloadedInventoryMovements,
            reloadedProjectAllocations,
          ] = await Promise.all([
            loadProjectSites(authSession.accessToken),
            loadInventoryItems(authSession.accessToken),
            loadDeviceRecipes(authSession.accessToken),
            loadPurchaseRequests(authSession.accessToken),
            loadProjectDocuments(authSession.accessToken),
            loadBuildTransactions(authSession.accessToken),
            loadInventoryMovements(authSession.accessToken),
            loadProjectAllocations(authSession.accessToken),
          ]);
          setProjectSites(reloadedProjectSites);
          setInventoryItems(reloadedInventoryItems);
          setDeviceRecipes(reloadedDeviceRecipes);
          setPurchaseRequests(reloadedPurchaseRequests);
          purchaseRequestsRef.current = reloadedPurchaseRequests;
          setProjectDocuments(reloadedProjectDocuments);
          setBuildTransactions(reloadedBuildTransactions);
          setInventoryMovements(reloadedInventoryMovements);
          setProjectAllocations(reloadedProjectAllocations);
          setAuthStatus("Backup restored.");
        } catch {
          setSyncStatus("error");
          setAuthStatus("Backup restore failed.");
        }
      })();
    };
    reader.readAsText(file);
  }

  async function handleSignIn() {
    try {
      const session = await signInWithPassword(authEmail.trim(), authPassword);
      // If this account was created from an invite link but the project
      // requires email confirmation, the invite couldn't be applied at
      // signup time (no session existed yet) -- it was stashed instead. Now
      // that we have a real session, finish applying it so the account gets
      // its role + auto-approval instead of falling back to the manual
      // Pending Approvals queue.
      const pendingInviteToken = window.localStorage.getItem("pendingInviteToken");
      let inviteFailure: string | null = null;
      if (pendingInviteToken) {
        window.localStorage.removeItem("pendingInviteToken");
        try {
          await acceptInvite(pendingInviteToken, session.accessToken);
        } catch (error) {
          inviteFailure = error instanceof Error ? error.message : "Could not finish accepting your invite.";
        }
      }
      setAuthSession(session);
      setAuthPassword("");
      setAuthStatus(
        inviteFailure
          ? `Signed in as ${session.email}, but your invite could not be applied: ${inviteFailure}. Ask an admin to resend the invite or approve your account.`
          : `Signed in as ${session.email}.`
      );
      setSyncStatus(inviteFailure ? "error" : "loading");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Sign in failed.");
      setSyncStatus("error");
    }
  }

  function handleGoogleSignIn() {
    try {
      setAuthStatus("Redirecting to Google...");
      signInWithGoogleRedirect();
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Google sign-in is not available yet.");
      setSyncStatus("error");
    }
  }

  async function handleRequestPasswordReset(emailOverride?: string): Promise<boolean> {
    const email = (emailOverride ?? authEmail).trim();
    if (!email) {
      setAuthStatus("Enter an email first, then request a password reset.");
      return false;
    }
    try {
      await requestPasswordReset(email);
      setAuthStatus(`Password reset link sent to ${email}. Check email on that device.`);
      return true;
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Could not send password reset.");
      setSyncStatus("error");
      return false;
    }
  }

  async function handleFinishPasswordReset() {
    if (!passwordResetSession) {
      setAuthStatus("This password reset link is no longer active. Request a new one.");
      return;
    }
    if (newPassword.length < 8) {
      setAuthStatus("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setAuthStatus("New passwords do not match.");
      return;
    }
    try {
      await updatePasswordWithRecovery(passwordResetSession.accessToken, newPassword);
      setPasswordResetSession(null);
      setNewPassword("");
      setConfirmNewPassword("");
      await signOut(passwordResetSession);
      setAuthSession(null);
      setAuthEmail(passwordResetSession.email);
      setAuthStatus("Password updated. Sign in with the new password.");
      setSyncStatus("auth");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Could not update password.");
      setSyncStatus("error");
    }
  }

  async function handleSignUp() {
    try {
      const session = await signUpWithPassword(authEmail.trim(), authPassword);
      setAuthPassword("");
      if (!session) {
        setAuthStatus("Account created. Check email confirmation, then sign in.");
        return;
      }
      setAuthSession(session);
      setAuthStatus(`Signed in as ${session.email}.`);
      setSyncStatus("loading");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Sign up failed.");
      setSyncStatus("error");
    }
  }

  async function handleSignOut() {
    await signOut(authSession);
    setAuthSession(null);
    setAuthStatus("Signed out. Local browser cache remains visible until cloud sign in.");
    setSyncStatus(isRemotePersistenceConfigured() ? "auth" : "local");
  }

  const requiresSignIn = isRemotePersistenceConfigured() && !authSession;

  if (passwordResetSession) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-card">
          <img className="auth-gate-logo" src="/ergon-logo.png" alt="Ergon" />
          <h2>Reset password</h2>
          <p className="muted">Set a new password for {passwordResetSession.email}.</p>
          <label className="auth-gate-field">New password<input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password" type="password" autoComplete="new-password" /></label>
          <label className="auth-gate-field">Confirm password<input value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} placeholder="Confirm password" type="password" autoComplete="new-password" /></label>
          <div className="auth-gate-actions">
            <button className="primary-action" type="button" onClick={handleFinishPasswordReset} disabled={!newPassword || !confirmNewPassword}>Update password</button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                setPasswordResetSession(null);
                setNewPassword("");
                setConfirmNewPassword("");
                setAuthStatus("Password reset canceled.");
              }}
            >
              Cancel
            </button>
          </div>
          <small className="auth-gate-status">{authStatus}</small>
        </div>
      </div>
    );
  }

  if (requiresSignIn) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-card">
          <img className="auth-gate-logo" src="/ergon-logo.png" alt="Ergon" />
          <h2>Sign in to continue</h2>
          <p className="muted">Inventory, purchasing, projects, and reports are only visible after you sign in.</p>
          <label className="auth-gate-field">Email<input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@company.com" type="email" autoComplete="email" /></label>
          <label className="auth-gate-field">Password<input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Password" type="password" autoComplete="current-password" /></label>
          <div className="auth-gate-actions">
            <button className="primary-action" type="button" onClick={handleSignIn} disabled={!authEmail || !authPassword}>Sign in</button>
            <button className="secondary-action" type="button" onClick={handleSignUp} disabled={!authEmail || !authPassword}>Create user</button>
          </div>
          <button className="link-button auth-reset-link" type="button" onClick={() => handleRequestPasswordReset()} disabled={!authEmail.trim()}>
            Forgot password?
          </button>
          <div className="auth-gate-divider">or</div>
          <button className="secondary-action auth-gate-google" type="button" onClick={handleGoogleSignIn}>Sign in with Google</button>
          <small className="auth-gate-status">{authStatus}</small>
        </div>
      </div>
    );
  }

  if (authSession && isRemotePersistenceConfigured() && !authChecksReady) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-card">
          <img className="auth-gate-logo" src="/ergon-logo.png" alt="Ergon" />
          <p className="muted auth-gate-loading">Checking your account...</p>
        </div>
      </div>
    );
  }

  const isApproved =
    isAdmin ||
    (userApprovalStatus?.approvalStatus === "approved" &&
      (!userApprovalStatus.expiresAt || new Date(userApprovalStatus.expiresAt).getTime() > Date.now()));

  if (authSession && isRemotePersistenceConfigured() && !isApproved) {
    const isExpired = Boolean(
      userApprovalStatus?.approvalStatus === "approved" && userApprovalStatus.expiresAt && new Date(userApprovalStatus.expiresAt).getTime() <= Date.now(),
    );
    const isDenied = userApprovalStatus?.approvalStatus === "denied";
    return (
      <div className="auth-gate">
        <div className="auth-gate-card">
          <img className="auth-gate-logo" src="/ergon-logo.png" alt="Ergon" />
          <h2>{isDenied ? "Access denied" : isExpired ? "Access expired" : "Waiting for approval"}</h2>
          <p className="muted">
            {isDenied
              ? "A Manager or Admin has denied access for this account. Contact your Ergon admin if you believe this is a mistake."
              : isExpired
                ? "Your access has expired. Ask a Manager or Admin to renew it."
                : "Your account is signed in but a Manager or Admin needs to approve access before you can use Ergon."}
          </p>
          <div className="auth-gate-actions">
            <button className="secondary-action" type="button" onClick={handleSignOut}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  const effectiveRoleDefaultTabs: View[] = Array.from(
    new Set(
      (ownRoleKeys.length > 0 ? ownRoleKeys : [roleMode]).flatMap(
        (key) => DEFAULT_TABS_BY_ROLE[key as RoleMode] ?? [],
      ),
    ),
  );
  const allowedTabs: View[] = isAdmin
    ? ALL_TABS
    : ((ownAllowedViews && ownAllowedViews.length > 0 ? ownAllowedViews : effectiveRoleDefaultTabs) as View[]);
  const isManagerRole = authChecksReady && (roleMode === "manager" || ownRoleKeys.includes("manager"));
  const canReviewApprovals = isAdmin || isManagerRole;

  if (authSession && isRemotePersistenceConfigured() && userApprovalStatus && !userApprovalStatus.hasSeenWelcome) {
    return (
      <WelcomeSlideshow
        companyName={branding.companyName}
        allowedTabs={allowedTabs}
        onFinish={() => {
          markWelcomeSeen(authSession.userId, authSession.accessToken);
          setUserApprovalStatus((current) => (current ? { ...current, hasSeenWelcome: true } : current));
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="top-nav-row">
          <div className="brand">
            <img className="brand-mark" src={(branding.logoStoragePath && companyLogoUrl(branding.logoStoragePath)) || "/ergon-icon.png"} alt={branding.companyName} />
            <div>
              <div className="brand-title">{branding.companyName}</div>
              <div className="brand-subtitle">Ops Command</div>
            </div>
          </div>
          <nav className="nav-list">
            {allowedTabs.includes("dashboard") && <NavButton icon={<LayoutDashboard size={16} />} label="Dashboard" active={view === "dashboard"} onClick={() => navigateToView("dashboard")} />}
            {allowedTabs.includes("purchasing") && <NavButton icon={<ShoppingCart size={16} />} label="Procurement" active={view === "purchasing"} onClick={() => navigateToView("purchasing")} />}
            {allowedTabs.includes("inventory") && <NavButton icon={<Boxes size={16} />} label="Inventory" active={view === "inventory"} onClick={() => navigateToView("inventory")} />}
            {allowedTabs.includes("projects") && <NavButton icon={<ClipboardList size={16} />} label="Projects" active={view === "projects"} onClick={() => navigateToView("projects")} />}
            {allowedTabs.includes("sales") && <NavButton icon={<DollarSign size={16} />} label="Sales" active={view === "sales"} onClick={() => navigateToView("sales")} />}
            {allowedTabs.includes("tasks") && <NavButton icon={<ListChecks size={16} />} label="Tasks" active={view === "tasks"} onClick={() => navigateToView("tasks")} />}
            {allowedTabs.includes("reports") && <NavButton icon={<BarChart3 size={16} />} label="Reports" active={view === "reports"} onClick={() => navigateToView("reports")} />}
            {allowedTabs.includes("saas_calendar") && <NavButton icon={<CalendarDays size={16} />} label="SaaS Calendar" active={view === "saas_calendar"} onClick={() => navigateToView("saas_calendar")} />}
          </nav>
          <div className="top-nav-actions">
            <div className={`sync-status ${syncStatus}`} title={syncStatus === "error" ? authStatus : undefined}>
              <span>{syncStatus === "local" ? "Setup required" : syncStatus === "auth" ? "Sign in required" : syncStatus === "loading" ? "Cloud loading" : syncStatus === "saving" ? "Saving" : syncStatus === "synced" ? "Cloud synced" : "Sync issue"}</span>
            </div>
            {pendingPhotoCount > 0 && (
              <div className="sync-status error" title="Captured while offline -- uploads automatically once you're back online">
                <span>{pendingPhotoCount} photo(s) waiting to upload</span>
              </div>
            )}
            <button className={`icon-button library-nav-button ${view === "library" ? "active" : ""}`} type="button" onClick={() => navigateToView("library")} aria-label="Learning Library" title="Learning Library">
              <BookOpen size={17} />
            </button>
            <div className="notification-bell">
              <button className="notification-bell-trigger" type="button" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Notifications">
                <Bell size={17} />
                {notifications.some((entry) => !entry.isRead) && <span className="notification-dot" />}
              </button>
              {notificationsOpen && (
                <div className="notification-panel">
                  <div className="notification-panel-header">
                    <strong>Notifications</strong>
                    <button className="secondary-action mini-action" type="button" onClick={handleMarkAllNotificationsRead}>Mark all read</button>
                  </div>
                  <div className="notification-list">
                    {notifications.map((entry) => (
                      <button key={entry.id} className={`notification-row ${entry.isRead ? "" : "is-unread"}`} type="button" onClick={() => handleNotificationClick(entry)}>
                        <strong>{entry.title}</strong>
                        <span>{entry.body}</span>
                        <small>{new Date(entry.createdAt).toLocaleString()}</small>
                      </button>
                    ))}
                    {notifications.length === 0 && <div className="empty-compact-state">No notifications yet.</div>}
                  </div>
                </div>
              )}
            </div>
            <div className="account-menu">
              <button className="account-menu-trigger" type="button" onClick={() => setAccountMenuOpen((open) => !open)}>
                <User size={16} />
                <span className="account-menu-email">{authSession?.email ?? "Account"}</span>
              </button>
              {accountMenuOpen && (
                <div className="account-menu-panel">
                  <label className="role-mode-select">Role view<select value={roleMode} onChange={(event) => setRoleMode(event.target.value as RoleMode)}>
                    {ROLE_KEY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select></label>
                  {canReviewApprovals && (
                    <button
                      className={`secondary-action mini-action account-menu-admin-link ${view === "admin" ? "active" : ""}`}
                      type="button"
                      onClick={() => {
                        navigateToView("admin");
                        setAccountMenuOpen(false);
                      }}
                    >
                      <User size={14} /> Admin
                    </button>
                  )}
                  <div className="auth-card">
                    {authSession ? (
                      <>
                        <span>{authSession.email}</span>
                        <button className="secondary-action mini-action" type="button" onClick={() => handleRequestPasswordReset(authSession.email)}>Reset password</button>
                        <button className="secondary-action mini-action" type="button" onClick={handleSignOut}>Sign out</button>
                      </>
                    ) : (
                      <>
                        <input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="Email" type="email" />
                        <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Password" type="password" />
                        <button className="secondary-action mini-action" type="button" onClick={handleSignIn} disabled={!isRemotePersistenceConfigured() || !authEmail || !authPassword}>Sign in</button>
                        <button className="secondary-action mini-action" type="button" onClick={handleSignUp} disabled={!isRemotePersistenceConfigured() || !authEmail || !authPassword}>Create user</button>
                        <button className="secondary-action mini-action" type="button" onClick={() => handleRequestPasswordReset()} disabled={!isRemotePersistenceConfigured() || !authEmail.trim()}>Reset password</button>
                        <button className="secondary-action mini-action" type="button" onClick={handleGoogleSignIn} disabled={!isRemotePersistenceConfigured()}>Sign in with Google</button>
                      </>
                    )}
                    <small>{isRemotePersistenceConfigured() ? authStatus : "Set Supabase env vars for production cloud storage."}</small>
                  </div>
                  <div className="backup-actions">
                    <button className="secondary-action mini-action" type="button" onClick={exportBackup}>Backup</button>
                    <label className="secondary-action mini-action">Restore<input type="file" accept="application/json,.json" onChange={(event) => { importBackup(event.target.files?.[0]); event.target.value = ""; }} /></label>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="top-nav-search">
          <Search size={16} />
          <input
            type="text"
            value={globalSearchQuery}
            placeholder="Search parts, POs, projects"
            onChange={(event) => {
              setGlobalSearchQuery(event.target.value);
              setGlobalSearchOpen(true);
            }}
            onFocus={() => setGlobalSearchOpen(true)}
            onBlur={() => setTimeout(() => setGlobalSearchOpen(false), 150)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeGlobalSearch();
              }
            }}
          />
          {globalSearchOpen && globalSearchTerm.length >= 2 && (
            <div className="global-search-results">
              {globalSearchMatches.projects.length === 0 && globalSearchMatches.parts.length === 0 && globalSearchMatches.orders.length === 0 && (
                <div className="global-search-empty">No matches for "{globalSearchQuery.trim()}".</div>
              )}
              {globalSearchMatches.projects.length > 0 && (
                <div className="global-search-group">
                  <span className="global-search-group-label">Projects</span>
                  {globalSearchMatches.projects.map((project) => (
                    <button key={project.ref} type="button" className="global-search-result" onMouseDown={(event) => event.preventDefault()} onClick={() => handleSelectSearchProject(project)}>
                      <strong>{project.name}</strong>
                      <span>{project.ref} - {project.client}</span>
                    </button>
                  ))}
                </div>
              )}
              {globalSearchMatches.parts.length > 0 && (
                <div className="global-search-group">
                  <span className="global-search-group-label">Parts</span>
                  {globalSearchMatches.parts.map((part) => (
                    <button key={part.ref} type="button" className="global-search-result" onMouseDown={(event) => event.preventDefault()} onClick={() => handleSelectSearchPart(part)}>
                      <strong>{part.name}</strong>
                      <span>{part.ref} - {part.stock} on hand</span>
                    </button>
                  ))}
                </div>
              )}
              {globalSearchMatches.orders.length > 0 && (
                <div className="global-search-group">
                  <span className="global-search-group-label">Purchase Orders</span>
                  {globalSearchMatches.orders.map((order) => (
                    <button key={order.number} type="button" className="global-search-result" onMouseDown={(event) => event.preventDefault()} onClick={() => handleSelectSearchOrder(order)}>
                      <strong>{order.number}</strong>
                      <span>{order.vendor} - {order.projectRef}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="main">
        <div className="page-heading">
          <h1>{view === "projects" && projectDetailContext ? `Project: ${projectDetailContext.name}` : pageTitle(view)}</h1>
          <p>{view === "projects" && projectDetailContext ? `Ref ${projectDetailContext.ref}` : pageSubtitle(view)}</p>
        </div>

        {view === "dashboard" && allowedTabs.includes("dashboard") && <Dashboard roleMode={roleMode} projectSites={projectSites} lowStock={lowStock} inventoryValue={inventoryValue} openPoValue={openPoValue} buildTransactions={buildTransactions} inventoryMovements={inventoryMovements} projectAllocations={projectAllocations} purchaseRequests={purchaseRequests} purchaseOrders={purchaseOrders} />}
        {view === "purchasing" && allowedTabs.includes("purchasing") && <Purchasing projectSites={projectSites} inventoryItems={inventoryItems} purchaseRequests={purchaseRequests} purchaseOrders={purchaseOrders} onCreatePurchaseOrder={handleCreatePurchaseOrder} onUpdatePurchaseOrderStatus={handleUpdatePurchaseOrderStatus} projectDocuments={projectDocuments} onCreateDocuments={handleCreateProjectDocuments} onUpdateDocumentStatus={handleUpdateProjectDocumentStatus} onDownloadDocument={handleDownloadDocument} lowStock={lowStock} buildTransactions={buildTransactions} onQueueReorderRequests={queueReorderRequests} onQueuePlannedBuildShortageRequests={queuePlannedBuildShortageRequests} onQueueManualPurchaseRequest={queueManualPurchaseRequest} onUpdatePurchaseRequest={updatePurchaseRequest} onUpdatePurchaseRequestStatus={updatePurchaseRequestStatus} onCancelPurchaseRequest={cancelPurchaseRequest} onReceivePurchaseRequest={receivePurchaseRequest} tasks={tasks} taskActivity={taskActivity} teamMembers={teamMembers} onCreateTask={handleCreateTask} onUpdateTask={handleUpdateTask} onDeleteTask={handleDeleteTask} onOpenTasksView={() => navigateToView("tasks")} searchFocus={purchasingSearchFocus} />}
        {view === "inventory" && allowedTabs.includes("inventory") && <Inventory roleMode={roleMode} inventoryItems={inventoryItems} lowStock={lowStock} projectSites={projectSites} deviceRecipes={deviceRecipes} setDeviceRecipes={setDeviceRecipes} buildTransactions={buildTransactions} inventoryMovements={inventoryMovements} onAddItem={addInventoryItem} onUpdateItem={updateInventoryItem} onReceiveStock={receiveInventoryStock} onAdjustStock={adjustInventoryStock} onTransferToProject={transferInventoryToProject} onPlanBuild={planBuildTransaction} onBuildInventoryUnit={buildInventoryUnit} onUndoBuildTransaction={undoBuildTransaction} onUpdateBuildStage={updateBuildStage} onCancelPlannedBuild={cancelPlannedBuild} onQueueBuildShortageRequests={queueBuildShortageRequests} tasks={tasks} taskActivity={taskActivity} teamMembers={teamMembers} onCreateTask={handleCreateTask} onUpdateTask={handleUpdateTask} onDeleteTask={handleDeleteTask} onOpenTasksView={() => navigateToView("tasks")} searchFocus={inventorySearchFocus} purchaseRequests={purchaseRequests} onOpenPurchasing={(term) => { setPurchasingSearchFocus({ term, token: Date.now() }); navigateToView("purchasing"); }} />}
        {view === "projects" && allowedTabs.includes("projects") && <Projects projectSites={projectSites} setProjectSites={setProjectSites} inventoryItems={inventoryItems} projectDocuments={projectDocuments} onCreateDocuments={handleCreateProjectDocuments} onUpdateDocumentStatus={handleUpdateProjectDocumentStatus} onDownloadDocument={handleDownloadDocument} onInventoryPull={pullFromInventory} onQueueProjectBomPurchaseRequest={queueProjectBomPurchaseRequest} tasks={tasks} taskActivity={taskActivity} teamMembers={teamMembers} onCreateTask={handleCreateTask} onUpdateTask={handleUpdateTask} onDeleteTask={handleDeleteTask} onOpenTasksView={() => navigateToView("tasks")} scheduleTemplates={scheduleTemplates} scheduleStatus={scheduleStatus} onGenerateSchedule={handleGenerateSchedule} submittals={submittals} submittalStatus={submittalStatus} onLoadSubmittals={reloadSubmittals} onCreateSubmittal={handleCreateSubmittal} handoverSchema={handoverSchema} handovers={handovers} handoverStatus={handoverStatus} onLoadHandovers={reloadHandovers} onCreateHandover={handleCreateHandover} onSaveHandoverResponses={handleSaveHandoverResponses} onSubmitHandover={handleSubmitHandover} salesQuotes={salesQuotes} onPullBomFromClosedQuote={handlePullBomFromClosedQuote} catalogItems={catalogItems} onAddProjectLocation={handleAddProjectLocation} onUpdateProjectLocation={handleUpdateProjectLocation} onDeleteProjectLocation={handleDeleteProjectLocation} onAddProjectLocationItem={handleAddProjectLocationItem} onUpdateProjectLocationItem={handleUpdateProjectLocationItem} onDeleteProjectLocationItem={handleDeleteProjectLocationItem} onUploadProjectLocationImage={handleUploadProjectLocationImage} onDownloadProjectLocationImage={handleDownloadProjectLocationImage} onDeleteProjectLocationImage={handleDeleteProjectLocationImage} onGetProjectLocationImageUrl={handleGetProjectLocationImageUrl} onUpdateProjectLocationImageDescription={handleUpdateProjectLocationImageDescription} onUpdateProjectLocationImageMeta={handleUpdateProjectLocationImageMeta} onMoveProjectLocationImage={handleMoveProjectLocationImage} onAddProjectShippingAddress={handleAddProjectShippingAddress} onAddProjectShipment={handleAddProjectShipment} onMarkProjectShipmentPacked={handleMarkProjectShipmentPacked} onMarkProjectShipmentShipped={handleMarkProjectShipmentShipped} onUploadProjectShipmentPhoto={handleUploadProjectShipmentPhoto} onDeleteProjectShipmentPhoto={handleDeleteProjectShipmentPhoto} onGetProjectShipmentPhotoUrl={handleGetProjectShipmentPhotoUrl} onDetailContextChange={setProjectDetailContext} purchaseOrders={purchaseOrders} />}
        {view === "sales" && allowedTabs.includes("sales") && (
          <SalesHome
            catalogItems={catalogItems}
            catalogStatus={catalogStatus}
            isConfigured={isRemotePersistenceConfigured()}
            canManageCatalog={isAdmin || isManagerRole}
            onCreateCatalogItem={handleCreateCatalogItem}
            onUpdateCatalogItem={handleUpdateCatalogItem}
            onSetCatalogItemRetired={handleSetCatalogItemRetired}
            onBulkImportCatalogItems={handleBulkCreateCatalogItems}
            onRefreshCatalog={() => authSession && reloadCatalog(authSession.accessToken)}
            onUploadCatalogDatasheet={handleUploadCatalogDatasheet}
            inventoryItems={inventoryItems}
            currentUserEmail={authSession?.email ?? ""}
            priceChangeRequests={catalogPriceChangeRequests}
            priceChangeStatus={catalogPriceChangeStatus}
            onProposePriceChange={handleProposeCatalogPriceChange}
            salesQuotes={salesQuotes}
            salesQuoteStatus={salesQuoteStatus}
            onCreateSalesQuote={handleCreateSalesQuote}
            onAddSalesQuoteLocation={handleAddSalesQuoteLocation}
            onUpdateSalesQuoteLocation={handleUpdateSalesQuoteLocation}
            onDeleteSalesQuoteLocation={handleDeleteSalesQuoteLocation}
            onAddSalesQuoteLocationItem={handleAddSalesQuoteLocationItem}
            onUpdateSalesQuoteLocationItem={handleUpdateSalesQuoteLocationItem}
            onDeleteSalesQuoteLocationItem={handleDeleteSalesQuoteLocationItem}
            onPullLocationHardwareIntoQuoteBom={handlePullLocationHardwareIntoQuoteBom}
            onUpdateSalesQuoteStatus={handleUpdateSalesQuoteStatus}
            onDeleteSalesQuote={handleDeleteSalesQuote}
            onCreateProjectFromClosedWonQuote={handleCreateProjectFromClosedWonQuote}
            onAddSalesQuoteBomLines={handleAddSalesQuoteBomLines}
            onDeleteSalesQuoteBomLine={handleDeleteSalesQuoteBomLine}
            onUpdateSalesQuoteBomLineCatalogLink={handleUpdateSalesQuoteBomLineCatalogLink}
            onUpdateSalesQuoteProposalFields={handleUpdateSalesQuoteProposalFields}
            onUpdateSalesQuoteInfo={handleUpdateSalesQuoteInfo}
            siteIntakeSchema={siteIntakeSchema}
            quoteIntakeResponses={quoteIntakeResponses}
            quoteIntakeStatus={quoteIntakeStatus}
            onLoadSalesQuoteIntakeResponse={handleLoadSalesQuoteIntakeResponse}
            onSaveSalesQuoteIntakeResponses={handleSaveSalesQuoteIntakeResponses}
            quoteProposals={quoteProposals}
            quoteProposalStatus={quoteProposalStatus}
            onLoadQuoteProposals={reloadQuoteProposals}
            onCreateQuoteProposal={handleCreateQuoteProposal}
            presalesRules={presalesRules}
            presalesStatus={presalesStatus}
            onGenerateBaselineBomForQuote={handleGenerateBaselineBomForQuote}
            onUploadSalesQuoteImage={handleUploadSalesQuoteImage}
            onUpdateSalesQuoteImageDescription={handleUpdateSalesQuoteImageDescription}
            onUpdateSalesQuoteImageMeta={handleUpdateSalesQuoteImageMeta}
            onMoveSalesQuoteImage={handleMoveSalesQuoteImage}
            onDownloadSalesQuoteImage={handleDownloadSalesQuoteImage}
            onDeleteSalesQuoteImage={handleDeleteSalesQuoteImage}
            onGetSalesQuoteImageUrl={handleGetSalesQuoteImageUrl}
            siteHardwareRules={siteHardwareRules}
            projectSites={projectSites}
            tasks={tasks}
            taskActivity={taskActivity}
            teamMembers={teamMembers}
            onCreateTask={handleCreateTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onOpenTasksView={() => navigateToView("tasks")}
          />
        )}
        {view === "tasks" && allowedTabs.includes("tasks") && (
          <TasksBoard
            tasks={tasks}
            taskActivity={taskActivity}
            projectSites={projectSites}
            teamMembers={teamMembers}
            status={taskStatusMessage}
            onCreate={handleCreateTask}
            onUpdate={handleUpdateTask}
            onDelete={handleDeleteTask}
            deletedTasks={deletedTasks}
            onRestore={handleRestoreTask}
            canReviewDeletedTasks={isAdmin || roleMode === "manager"}
            onRefresh={() => authSession && reloadTasks(authSession.accessToken)}
            inventoryItems={inventoryItems}
            taskHardwareDependencies={taskHardwareDependencies}
            onAddTaskDependency={handleAddTaskDependency}
            onDeleteTaskDependency={handleDeleteTaskDependency}
            focusTask={taskFocus}
          />
        )}
        {view === "reports" && allowedTabs.includes("reports") && <Reports inventoryItems={inventoryItems} deviceRecipes={deviceRecipes} inventoryValue={inventoryValue} openPoValue={openPoValue} inventoryMovements={inventoryMovements} buildTransactions={buildTransactions} projectAllocations={projectAllocations} purchaseRequests={purchaseRequests} purchaseOrders={purchaseOrders} projectDocuments={projectDocuments} searchFocus={reportsSearchFocus} />}
        {view === "saas_calendar" && allowedTabs.includes("saas_calendar") && <SaasCalendar projectSites={projectSites} />}
        {view === "library" && <LibraryPage onBack={() => navigateToView("dashboard")} />}
        {view === "admin" && canReviewApprovals && (
          <AdminPage
            currentUserId={authSession?.userId ?? ""}
            isAdmin={isAdmin}
            isManagerRole={isManagerRole}
            knownUsers={knownUsers}
            userRoleMap={userRoleMap}
            adminIds={adminIds}
            allowedViewsMap={allowedViewsMap}
            approvalStatuses={approvalStatuses}
            status={adminStatus}
            approvalStatusMessage={approvalReviewStatus}
            onSetRole={handleSetUserRole}
            onSetSecondaryRoles={handleSetSecondaryRoles}
            onGrantAdmin={handleGrantAdmin}
            onRevokeAdmin={handleRevokeAdmin}
            onSetAllowedViews={handleSetAllowedViews}
            onReviewApproval={handleReviewApproval}
            branding={branding}
            brandingStatus={brandingStatus}
            onSaveCompanyName={handleSaveCompanyName}
            onUploadLogo={handleUploadCompanyLogo}
            teamMembers={teamMembers}
            teamMemberStatus={teamMemberStatus}
            onAddTeamMember={handleAddTeamMember}
            onUpdateTeamMember={handleUpdateTeamMember}
            notificationRules={notificationRules}
            onUpdateNotificationRule={handleUpdateNotificationRule}
            standardInstallTimes={standardInstallTimes}
            onSaveStandardInstallTime={handleSaveStandardInstallTime}
            scheduleTemplates={scheduleTemplates}
            onCreateScheduleTemplate={handleCreateScheduleTemplate}
            onAddSchedulePhase={handleAddSchedulePhase}
            onDeleteSchedulePhase={handleDeleteSchedulePhase}
            handoverSchema={handoverSchema}
            formBuilderStatus={formBuilderStatus}
            onAddFormField={handleAddFormField}
            onUpdateFormField={handleUpdateFormField}
            onDeleteFormField={handleDeleteFormField}
            onReorderFormField={handleReorderFormField}
            siteIntakeSchema={siteIntakeSchema}
            siteIntakeFormBuilderStatus={siteIntakeFormBuilderStatus}
            onAddSiteIntakeField={handleAddSiteIntakeField}
            onUpdateSiteIntakeField={handleUpdateSiteIntakeField}
            onDeleteSiteIntakeField={handleDeleteSiteIntakeField}
            onReorderSiteIntakeField={handleReorderSiteIntakeField}
            presalesRules={presalesRules}
            presalesStatus={presalesStatus}
            onAddPresalesRule={handleAddPresalesRule}
            onDeletePresalesRule={handleDeletePresalesRule}
            siteHardwareRules={siteHardwareRules}
            siteHardwareRuleStatus={siteHardwareRuleStatus}
            onAddSiteHardwareRule={handleAddSiteHardwareRule}
            onUpdateSiteHardwareRule={handleUpdateSiteHardwareRule}
            onDeleteSiteHardwareRule={handleDeleteSiteHardwareRule}
            catalogPriceChangeRequests={catalogPriceChangeRequests}
            catalogItems={catalogItems}
            catalogPriceChangeStatus={catalogPriceChangeStatus}
            onApproveCatalogPriceChange={handleApproveCatalogPriceChange}
            onRejectCatalogPriceChange={handleRejectCatalogPriceChange}
            invites={invites}
            inviteStatus={inviteStatus}
            onSendInvite={handleSendInvite}
            onResendInvite={handleResendInvite}
            onRevokeInvite={handleRevokeInvite}
            onSendPasswordReset={(email) => handleRequestPasswordReset(email)}
            proposalTemplateSections={proposalTemplateSections}
            onUpdateProposalTemplateSection={handleUpdateProposalTemplateSection}
            onRefresh={() => {
              if (!authSession) {
                return;
              }
              reloadAdminDirectory(authSession.accessToken);
              reloadApprovalQueue(authSession.accessToken);
            }}
          />
        )}
      </main>

      <MobileBottomNav view={view} allowedTabs={allowedTabs} roleMode={roleMode} canReviewApprovals={canReviewApprovals} onNavigate={navigateToView} />
      <InstallAppBanner />
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

// Mobile-only bottom nav (ported from the VLTD app's BottomNav) -- 2 tabs,
// a center action button, 1 more tab, then "More" for anything that
// doesn't fit. Mirrors the top header's allowedTabs instead of a fixed
// set, so it stays correct for every role/per-user tab override.
function MobileBottomNav({
  view,
  allowedTabs,
  roleMode,
  canReviewApprovals,
  onNavigate,
}: {
  view: View;
  allowedTabs: View[];
  roleMode: RoleMode;
  canReviewApprovals: boolean;
  onNavigate: (view: View) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const orderedTabs = ALL_TABS.filter((tab) => allowedTabs.includes(tab));
  const primaryTabs = orderedTabs.slice(0, 3);
  const overflowTabs = orderedTabs.slice(3);
  const hasMore = overflowTabs.length > 0 || canReviewApprovals;
  const leftTabs = primaryTabs.slice(0, 2);
  const rightTabs = hasMore ? primaryTabs.slice(2, 3) : primaryTabs.slice(2);

  const quickAction = ROLE_QUICK_ACTION[roleMode];
  const centerTarget = allowedTabs.includes(quickAction.view) ? quickAction : { view: "dashboard" as View, label: "Dashboard" };

  function go(target: View) {
    setMoreOpen(false);
    onNavigate(target);
  }

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {moreOpen && (
        <>
          <div className="mobile-nav-more-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="mobile-nav-more-sheet">
            <div className="mobile-nav-more-grab" />
            <div className="mobile-nav-more-label">More</div>
            <div className="mobile-nav-more-grid">
              {overflowTabs.map((tab) => (
                <button key={tab} type="button" className="mobile-nav-more-item" onClick={() => go(tab)}>
                  {MOBILE_NAV_TAB_ICON[tab](22)}
                  <span>{TAB_LABELS[tab]}</span>
                </button>
              ))}
              <button type="button" className="mobile-nav-more-item" onClick={() => go("library")}>
                {MOBILE_NAV_TAB_ICON.library(22)}
                <span>{TAB_LABELS.library}</span>
              </button>
              {canReviewApprovals && (
                <button type="button" className="mobile-nav-more-item" onClick={() => go("admin")}>
                  {MOBILE_NAV_TAB_ICON.admin(22)}
                  <span>{TAB_LABELS.admin}</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
      <div className="mobile-bottom-nav-bar">
        {leftTabs.map((tab) => (
          <button key={tab} type="button" className={`mobile-nav-tab ${view === tab ? "active" : ""}`} onClick={() => go(tab)}>
            {MOBILE_NAV_TAB_ICON[tab](21)}
            <span>{TAB_LABELS[tab]}</span>
          </button>
        ))}
        <button type="button" className="mobile-nav-center" onClick={() => go(centerTarget.view)} aria-label={centerTarget.label}>
          <span className="mobile-nav-center-button">
            <Plus size={22} />
          </span>
          <span className="mobile-nav-center-label">{centerTarget.label}</span>
        </button>
        {rightTabs.map((tab) => (
          <button key={tab} type="button" className={`mobile-nav-tab ${view === tab ? "active" : ""}`} onClick={() => go(tab)}>
            {MOBILE_NAV_TAB_ICON[tab](21)}
            <span>{TAB_LABELS[tab]}</span>
          </button>
        ))}
        {hasMore && (
          <button type="button" className={`mobile-nav-tab ${moreOpen ? "active" : ""}`} onClick={() => setMoreOpen((current) => !current)}>
            <MoreHorizontal size={21} />
            <span>More</span>
          </button>
        )}
      </div>
    </nav>
  );
}

// PWA "Add to Home Screen" -- ported from the VLTD app's PWAInstallBanner,
// then reworked (2026-08-18) to always render instead of waiting on the
// browser's beforeinstallprompt event: that event is gated by Chrome's own
// installability + engagement heuristics, which this app has no control
// over and which don't fire reliably (or at all) in every browser -- E
// correctly pushed back that whether the affordance *appears* shouldn't
// depend on the browser's mood. Now the pill always shows (unless already
// installed or dismissed); tapping it either fires the real one-tap
// install (when Chrome has handed us a deferred prompt) or expands plain
// manual steps for the browser's own "Install app" / "Add to Home Screen"
// menu item, which works everywhere, including desktop Chrome, Firefox,
// and any Android browser we don't get an event from.
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISSED_KEY = "ergon:pwaInstallDismissedUntil";
const INSTALL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsStandalone(true);
      return;
    }
    const until = window.localStorage.getItem(INSTALL_DISMISSED_KEY);
    if (until && Date.now() < Number(until)) {
      setDismissed(true);
    }
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios/i.test(navigator.userAgent));
    function handler(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss(event: React.MouseEvent) {
    event.stopPropagation();
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now() + INSTALL_COOLDOWN_MS));
    setDismissed(true);
  }

  async function handleTap() {
    if (!deferredPrompt) {
      setExpanded((current) => !current);
      return;
    }
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === "accepted") {
      window.localStorage.removeItem(INSTALL_DISMISSED_KEY);
      setDismissed(true);
    }
    setDeferredPrompt(null);
  }

  if (isStandalone || dismissed) {
    return null;
  }

  const manualSteps = isIOS
    ? (
      <>1. Tap the Share icon in Safari's toolbar.<br />2. Scroll down and tap "Add to Home Screen."</>
    )
    : (
      <>Open your browser's menu (the &#8942; or &#8943; icon) and choose "Install app" or "Add to Home Screen."</>
    );

  return (
    <div className={`install-banner ${!deferredPrompt ? "install-banner-ios" : ""}`}>
      <div className="install-banner-ios-row">
        <img src="/ergon-icon.png" alt="Ergon" className="install-banner-icon" />
        <button type="button" className="install-banner-ios-toggle" onClick={() => void handleTap()}>
          {deferredPrompt ? "Install app" : "Add to Home Screen"}
        </button>
        {deferredPrompt && (
          <button type="button" className="install-banner-install" onClick={() => void handleTap()} aria-label="Install">
            <Download size={13} />
          </button>
        )}
        <button type="button" className="install-banner-dismiss" onClick={dismiss} aria-label="Dismiss">x</button>
      </div>
      {expanded && !deferredPrompt && <p className="install-banner-ios-steps">{manualSteps}</p>}
    </div>
  );
}

function pageTitle(view: View) {
  const titles: Record<View, string> = {
    dashboard: "Dashboard",
    purchasing: "Procurement",
    inventory: "Inventory",
    projects: "Projects",
    sales: "Sales",
    tasks: "Tasks",
    reports: "Reports",
    saas_calendar: "SaaS Calendar",
    admin: "Admin",
    library: "Learning Library",
  };
  return titles[view];
}

// Was one hardcoded, procurement-flavored line shown under every page's
// title regardless of which page you were actually on -- E flagged that the
// Sales page was showing "Procurement, inventory, project transfers..."
// text with nothing to do with Sales.
function pageSubtitle(view: View) {
  const subtitles: Record<View, string> = {
    dashboard: "Procurement, inventory, project transfers, and reports for field packages.",
    purchasing: "Purchase requests, purchase orders, and receiving for field packages.",
    inventory: "Stock levels, movements, and equipment builds across the warehouse and projects.",
    projects: "Project list, completion tracking, BOM, and PM handoff status.",
    sales: "Pipeline, quotes, and the product catalog for new deals.",
    tasks: "Work items and requests across every team and project.",
    reports: "Cross-project analytics and exportable reports.",
    saas_calendar: "Renewal outreach tracker and recurring revenue outlook.",
    admin: "Users, roles, approvals, and system configuration.",
    library: "Reference guides and onboarding materials.",
  };
  return subtitles[view];
}

function Dashboard({
  roleMode,
  projectSites,
  lowStock,
  inventoryValue,
  openPoValue,
  buildTransactions,
  inventoryMovements,
  projectAllocations,
  purchaseRequests,
  purchaseOrders,
}: {
  roleMode: RoleMode;
  projectSites: ProjectSite[];
  lowStock: Part[];
  inventoryValue: number;
  openPoValue: number;
  buildTransactions: BuildTransaction[];
  inventoryMovements: InventoryMovement[];
  projectAllocations: ProjectAllocationHistory[];
  purchaseRequests: PurchaseRequest[];
  purchaseOrders: PurchaseOrder[];
}) {
  const importedLines = purchaseOrders.reduce((sum, order) => sum + order.lines.length, 0);
  const heldOrders = purchaseOrders.filter((order) => order.status === "On Hold");
  const plannedBuilds = buildTransactions.filter((build) => build.status === "planned");
  const activePurchaseRequests = purchaseRequests.filter((request) => !["Received", "Cancelled"].includes(request.status));
  const requestExposure = activePurchaseRequests.reduce((sum, request) => sum + request.quantity * request.estimatedUnitCost, 0);
  const recentReceipts = inventoryMovements.filter((movement) => movement.type === "receive").slice(0, 3);
  const recentTransfers = inventoryMovements.filter((movement) => movement.type === "transfer").slice(0, 3);
  const activityFeed = [
    ...purchaseRequests.map((request) => ({
      id: request.id,
      date: request.createdAt,
      kind: "Purchase",
      title: `${request.requestNumber} - ${request.itemName}`,
      detail: `${request.status} - ${Math.max(0, request.quantity - (request.receivedQuantity ?? 0))} remaining`,
    })),
    ...inventoryMovements.map((movement) => ({
      id: movement.id,
      date: movement.createdAt,
      kind: "Inventory",
      title: `${movement.type.replace("_", " ")} - ${movement.itemName}`,
      detail: `${movement.quantityBefore} to ${movement.quantityAfter}${movement.projectName ? ` - ${movement.projectName}` : ""}`,
    })),
    ...buildTransactions.map((build) => ({
      id: build.id,
      date: build.createdAt,
      kind: "Build",
      title: `${build.buildNumber} - ${build.equipmentName}`,
      detail: `${build.quantityBuilt} unit${build.quantityBuilt === 1 ? "" : "s"} - ${build.stage ?? build.status}`,
    })),
    ...projectAllocations.map((allocation) => ({
      id: allocation.id,
      date: allocation.createdAt,
      kind: "Project",
      title: `${allocation.projectName} - ${allocation.itemName}`,
      detail: `${allocation.action} ${allocation.quantity} from ${allocation.sku}`,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const roleFocus = {
    warehouse: {
      title: "Warehouse Focus",
      label: "Today: receive, count, transfer, and build readiness",
      cards: [
        { label: "Low stock SKUs", value: String(lowStock.length), note: "Use Inventory > Receive or Adjust" },
        { label: "Recent receipts", value: String(recentReceipts.length), note: recentReceipts[0]?.itemName ?? "No receipts logged yet" },
        { label: "Planned builds", value: String(plannedBuilds.length), note: plannedBuilds[0]?.equipmentName ?? "No planned builds" },
      ],
    },
    purchasing: {
      title: "Procurement Focus",
      label: "Today: shortages, held orders, and vendor cost changes",
      cards: [
        { label: "Open requests", value: String(activePurchaseRequests.length), note: activePurchaseRequests[0]?.itemName ?? "No queued purchase requests" },
        { label: "Reorder SKUs", value: String(lowStock.length), note: lowStock[0]?.name ?? "Inventory is above reorder points" },
        { label: "Captured spend", value: money(openPoValue), note: "From imported procurement data" },
      ],
    },
    pm: {
      title: "PM Focus",
      label: "Today: project readiness and allocation movement",
      cards: [
        { label: "Active projects", value: String(projectSites.length), note: projectSites[0]?.name ?? "No projects yet" },
        { label: "Recent transfers", value: String(recentTransfers.length), note: recentTransfers[0]?.projectName ?? "No project transfers yet" },
        { label: "Procurement projects", value: String(projectSites.filter((project) => project.status === "Procurement").length), note: "Need BOM/order follow-through" },
      ],
    },
    manager: {
      title: "Manager Focus",
      label: "Today: inventory value, procurement exposure, and manufacturing flow",
      cards: [
        { label: "Inventory value", value: money(inventoryValue), note: "Current stock value" },
        { label: "Request exposure", value: money(requestExposure), note: "Open purchase request estimate" },
        { label: "Build transactions", value: String(buildTransactions.length), note: `${plannedBuilds.length} planned` },
      ],
    },
    sales: {
      title: "Sales Focus",
      label: "Today: active projects and procurement exposure across the pipeline",
      cards: [
        { label: "Active projects", value: String(projectSites.length), note: projectSites[0]?.name ?? "No projects yet" },
        { label: "Open requests", value: String(activePurchaseRequests.length), note: activePurchaseRequests[0]?.itemName ?? "No queued purchase requests" },
        { label: "Inventory value", value: money(inventoryValue), note: "Current stock value" },
      ],
    },
    engineering: {
      title: "Engineering Focus",
      label: "Today: project readiness and inventory movement",
      cards: [
        { label: "Active projects", value: String(projectSites.length), note: projectSites[0]?.name ?? "No projects yet" },
        { label: "Recent transfers", value: String(recentTransfers.length), note: recentTransfers[0]?.projectName ?? "No project transfers yet" },
        { label: "Low stock SKUs", value: String(lowStock.length), note: "Use Inventory > Receive or Adjust" },
      ],
    },
    product_development: {
      title: "Product Development Focus",
      label: "Today: project pipeline and build planning",
      cards: [
        { label: "Active projects", value: String(projectSites.length), note: projectSites[0]?.name ?? "No projects yet" },
        { label: "Planned builds", value: String(plannedBuilds.length), note: plannedBuilds[0]?.equipmentName ?? "No planned builds" },
        { label: "Procurement projects", value: String(projectSites.filter((project) => project.status === "Procurement").length), note: "Need BOM/order follow-through" },
      ],
    },
    implementation: {
      title: "Implementation Focus",
      label: "Today: project readiness, procurement, and inventory",
      cards: [
        { label: "Active projects", value: String(projectSites.length), note: projectSites[0]?.name ?? "No projects yet" },
        { label: "Open requests", value: String(activePurchaseRequests.length), note: activePurchaseRequests[0]?.itemName ?? "No queued purchase requests" },
        { label: "Low stock SKUs", value: String(lowStock.length), note: "Use Inventory > Receive or Adjust" },
      ],
    },
    support: {
      title: "Support Focus",
      label: "Today: project status across active accounts",
      cards: [
        { label: "Active projects", value: String(projectSites.length), note: projectSites[0]?.name ?? "No projects yet" },
        { label: "Recent receipts", value: String(recentReceipts.length), note: recentReceipts[0]?.itemName ?? "No receipts logged yet" },
        { label: "Build transactions", value: String(buildTransactions.length), note: `${plannedBuilds.length} planned` },
      ],
    },
    marketing: {
      title: "Marketing Focus",
      label: "Today: overall account and project activity",
      cards: [
        { label: "Active projects", value: String(projectSites.length), note: projectSites[0]?.name ?? "No projects yet" },
        { label: "Inventory value", value: money(inventoryValue), note: "Current stock value" },
        { label: "Build transactions", value: String(buildTransactions.length), note: `${plannedBuilds.length} planned` },
      ],
    },
  } satisfies Record<RoleMode, { title: string; label: string; cards: { label: string; value: string; note: string }[] }>;
  const activeFocus = roleFocus[roleMode];

  return (
    <div className="content-grid">
      <section className="metric-grid">
        <Metric icon={<Boxes size={20} />} label="Inventory Value" value={money(inventoryValue)} />
        <Metric icon={<ShoppingCart size={20} />} label="Recent Order Spend" value={money(openPoValue)} />
        <Metric icon={<FileText size={20} />} label="Imported Line Items" value={String(importedLines)} />
        <Metric icon={<Truck size={20} />} label="Active Projects" value={String(projectSites.length)} />
      </section>

      <section className="panel wide">
        <PanelHeader title={activeFocus.title} label={activeFocus.label} />
        <div className="role-focus-grid">
          {activeFocus.cards.map((card) => (
            <article className="role-focus-card" key={card.label}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.note}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <PanelHeader title="Recent Activity" label="Combined purchasing, inventory, build, and project movement timeline" />
        <div className="activity-feed">
          {activityFeed.map((activity) => (
            <div className="activity-row" key={`${activity.kind}-${activity.id}`}>
              <span>{activity.kind}</span>
              <div>
                <strong>{activity.title}</strong>
                <small>{activity.detail}</small>
              </div>
              <time>{new Date(activity.date).toLocaleString()}</time>
            </div>
          ))}
          {activityFeed.length === 0 && <div className="empty-compact-state">No saved activity yet. Receiving, transfers, builds, and purchase requests will appear here.</div>}
        </div>
      </section>

      <section className="panel wide">
        <PanelHeader title="Package Matrix" label="BOM presets" />
        <div className="package-grid">
          {packageOptions.map((pkg) => (
            <article className="package-card" key={pkg.name}>
              <div className="package-cost">{money(pkg.costWithoutCameras)}</div>
              <h3>{pkg.name}</h3>
              <p>{pkg.condition}</p>
              <div className="mini-list">{pkg.items.slice(0, 5).join(", ")}{pkg.items.length > 5 ? "..." : ""}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Procurement Attention" label="Orders needing follow-up" />
        <div className="stack">
          {heldOrders.map((order) => (
            <div className="row-card" key={order.number}>
              <div>
                <strong>{order.vendor} {order.number}</strong>
                <span>{order.projectRef} - {order.paymentNote}</span>
              </div>
              <b>{money(order.total)}</b>
            </div>
          ))}
          {lowStock.slice(0, 3).map((part) => (
            <div className="row-card" key={part.name}>
              <div>
                <strong>{part.name}</strong>
                <span>{part.category} reorder watch</span>
              </div>
              <b>{part.stock} left</b>
            </div>
          ))}
          {activePurchaseRequests.slice(0, 3).map((request) => (
            <div className="row-card" key={request.id}>
              <div>
                <strong>{request.itemName}</strong>
                <span>{request.requestNumber} - {request.reason}</span>
              </div>
              <b>{request.quantity} needed</b>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Upcoming Projects" label="Transfers" />
        <div className="stack">
          {projectSites.map((project) => (
            <div className="row-card" key={project.name}>
              <div>
                <strong>{project.name}</strong>
                <span>{project.package}</span>
              </div>
              <b>{project.status}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Purchasing({
  projectSites,
  inventoryItems,
  purchaseRequests,
  purchaseOrders,
  onCreatePurchaseOrder,
  onUpdatePurchaseOrderStatus,
  projectDocuments,
  onCreateDocuments,
  onUpdateDocumentStatus,
  onDownloadDocument,
  lowStock,
  buildTransactions,
  onQueueReorderRequests,
  onQueuePlannedBuildShortageRequests,
  onQueueManualPurchaseRequest,
  onUpdatePurchaseRequest,
  onUpdatePurchaseRequestStatus,
  onCancelPurchaseRequest,
  onReceivePurchaseRequest,
  tasks,
  taskActivity,
  teamMembers,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onOpenTasksView,
  searchFocus,
}: {
  projectSites: ProjectSite[];
  inventoryItems: Part[];
  purchaseRequests: PurchaseRequest[];
  purchaseOrders: PurchaseOrder[];
  onCreatePurchaseOrder: (order: {
    number: string;
    vendor: string;
    date: string;
    projectRef: string;
    status: PurchaseOrder["status"];
    subtotal: number;
    tax: number;
    shipping: number;
    sourceFile: string;
    shipTo: string;
    paymentNote: string;
    lines: Array<{ name: string; category: PurchaseLineCategory; qty: number; unitCost: number }>;
  }) => void;
  onUpdatePurchaseOrderStatus: (id: string, status: PurchaseOrder["status"]) => void;
  projectDocuments: UploadedDoc[];
  onCreateDocuments: (entries: Array<{ doc: Omit<UploadedDoc, "id">; file?: File }>) => void;
  onUpdateDocumentStatus: (id: UploadedDoc["id"], status: UploadedDoc["status"]) => void;
  onDownloadDocument: (doc: UploadedDoc) => void;
  lowStock: Part[];
  buildTransactions: BuildTransaction[];
  onQueueReorderRequests: () => void;
  onQueuePlannedBuildShortageRequests: () => void;
  onQueueManualPurchaseRequest: (partRef: string, quantity: number, notes: string, projectName?: string, procurementTrack?: PurchaseRequest["procurementTrack"]) => void;
  onUpdatePurchaseRequest: (requestId: string, updates: Partial<Pick<PurchaseRequest, "quantity" | "preferredVendor" | "poNumber" | "expectedDate" | "estimatedUnitCost" | "status" | "notes" | "procurementTrack" | "projectName">>) => void;
  onUpdatePurchaseRequestStatus: (requestId: string, status: PurchaseRequest["status"]) => void;
  onCancelPurchaseRequest: (requestId: string) => void;
  onReceivePurchaseRequest: (requestId: string, quantityReceived: number, unitCost: number, notes: string) => void;
  tasks: EOTask[];
  taskActivity: TaskActivityEntry[];
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">) => Promise<boolean>;
  onUpdateTask: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => Promise<boolean>;
  onDeleteTask: (id: string) => void;
  onOpenTasksView: () => void;
  searchFocus?: { term: string; token: number } | null;
}) {
  const [selectedProject, setSelectedProject] = useState("");
  const [manualRequestPartRef, setManualRequestPartRef] = useState(() => inventoryItems.find((item) => !item.retired)?.ref ?? "");
  const [manualRequestQty, setManualRequestQty] = useState(1);
  const [manualRequestNotes, setManualRequestNotes] = useState("");
  const [manualRequestProject, setManualRequestProject] = useState("");
  const [manualRequestTrack, setManualRequestTrack] = useState<NonNullable<PurchaseRequest["procurementTrack"]>>("warehouse_stock");
  const [requestFilters, setRequestFilters] = useState({ text: "", status: "Open", reason: "All" });
  useEffect(() => {
    if (!searchFocus) {
      return;
    }
    setRequestFilters({ text: searchFocus.term, status: "All", reason: "All" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFocus?.token]);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [requestEditDraft, setRequestEditDraft] = useState({
    quantity: 1,
    preferredVendor: "",
    poNumber: "",
    expectedDate: "",
    estimatedUnitCost: 0,
    status: "Draft" as PurchaseRequest["status"],
    projectName: "",
    procurementTrack: "warehouse_stock" as NonNullable<PurchaseRequest["procurementTrack"]>,
    notes: "",
  });
  const [receivingRequestId, setReceivingRequestId] = useState<string | null>(null);
  const [requestReceiveDraft, setRequestReceiveDraft] = useState({ qty: 1, unitCost: 0, notes: "" });
  const totalSpend = purchaseOrders.reduce((sum, order) => sum + order.total, 0);
  const totalTax = purchaseOrders.reduce((sum, order) => sum + order.tax, 0);
  const openOrders = purchaseOrders.filter((order) => order.status !== "Imported").length;
  const projectSpend = Object.entries(sumBy(purchaseOrders, (order) => order.projectRef)).sort((a, b) => b[1] - a[1]);
  const documentProjects = Array.from(new Set([...purchaseOrders.map((order) => order.projectRef), ...projectSites.map((project) => project.name)]));
  useEffect(() => {
    if (!selectedProject && documentProjects.length > 0) {
      setSelectedProject(documentProjects[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentProjects.join("|")]);
  const activeProjectDocuments = projectDocuments.filter((doc) => doc.project === selectedProject || purchaseOrders.some((order) => order.projectRef === selectedProject && order.sourceFile === doc.name));
  const activeRequests = purchaseRequests.filter((request) => !["Received", "Cancelled"].includes(request.status));
  const plannedBuilds = buildTransactions.filter((build) => build.status === "planned").length;
  const receivingRequest = purchaseRequests.find((request) => request.id === receivingRequestId) ?? null;
  const editingRequest = purchaseRequests.find((request) => request.id === editingRequestId) ?? null;
  const receivingRemaining = receivingRequest ? Math.max(0, receivingRequest.quantity - (receivingRequest.receivedQuantity ?? 0)) : 0;
  const filteredPurchaseRequests = purchaseRequests.filter((request) => {
    const haystack = `${request.requestNumber} ${request.sku} ${request.itemName} ${request.preferredVendor ?? ""} ${request.sourceRef ?? ""} ${request.projectName ?? ""} ${request.procurementTrack ?? ""}`.toLowerCase();
    const statusMatch =
      requestFilters.status === "All" ||
      (requestFilters.status === "Open" && !["Received", "Cancelled"].includes(request.status)) ||
      request.status === requestFilters.status;
    const reasonMatch = requestFilters.reason === "All" || request.reason === requestFilters.reason;
    return haystack.includes(requestFilters.text.toLowerCase()) && statusMatch && reasonMatch;
  });

  function handleDocumentSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const entries = files.map((file, index) => ({
      doc: {
        name: file.name,
        project: selectedProject,
        size: file.size,
        status: "Ready to review" as const,
        type: "Procurement" as const,
        storage: "Browser" as const,
        uploadedAt: new Date(Date.now() + index).toISOString(),
      },
      file,
    }));
    onCreateDocuments(entries);
    event.target.value = "";
  }

  function updateProjectDocumentStatus(docId: UploadedDoc["id"], status: UploadedDoc["status"]) {
    onUpdateDocumentStatus(docId, status);
  }

  const blankPoLine = { name: "", category: "Other" as PurchaseLineCategory, qty: 1, unitCost: 0 };
  const [showPoForm, setShowPoForm] = useState(false);
  const [poDraft, setPoDraft] = useState({
    number: "",
    vendor: "",
    date: new Date().toISOString().slice(0, 10),
    projectRef: "",
    status: "Imported" as PurchaseOrder["status"],
    tax: 0,
    shipping: 0,
    sourceFile: "",
    shipTo: "",
    paymentNote: "",
    lines: [{ ...blankPoLine }],
  });
  const poSubtotal = poDraft.lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0);
  const poVendorOptions = Array.from(new Set(purchaseOrders.map((order) => order.vendor)));

  function updatePoLine(index: number, updates: Partial<typeof blankPoLine>) {
    setPoDraft((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...updates } : line)),
    }));
  }

  function addPoLine() {
    setPoDraft((current) => ({ ...current, lines: [...current.lines, { ...blankPoLine }] }));
  }

  function removePoLine(index: number) {
    setPoDraft((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }));
  }

  function resetPoDraft() {
    setPoDraft({
      number: "",
      vendor: "",
      date: new Date().toISOString().slice(0, 10),
      projectRef: "",
      status: "Imported",
      tax: 0,
      shipping: 0,
      sourceFile: "",
      shipTo: "",
      paymentNote: "",
      lines: [{ ...blankPoLine }],
    });
  }

  function submitPurchaseOrder() {
    if (!poDraft.number.trim() || !poDraft.vendor.trim()) {
      return;
    }
    const cleanLines = poDraft.lines.filter((line) => line.name.trim() && line.qty > 0);
    onCreatePurchaseOrder({
      number: poDraft.number.trim(),
      vendor: poDraft.vendor.trim(),
      date: poDraft.date,
      projectRef: poDraft.projectRef.trim(),
      status: poDraft.status,
      subtotal: poSubtotal,
      tax: poDraft.tax,
      shipping: poDraft.shipping,
      sourceFile: poDraft.sourceFile.trim(),
      shipTo: poDraft.shipTo.trim(),
      paymentNote: poDraft.paymentNote.trim(),
      lines: cleanLines,
    });
    resetPoDraft();
    setShowPoForm(false);
  }

  function submitManualRequest() {
    if (!manualRequestPartRef) {
      return;
    }
    const targetProject = manualRequestProject || undefined;
    onQueueManualPurchaseRequest(manualRequestPartRef, manualRequestQty, manualRequestNotes, targetProject, targetProject ? manualRequestTrack : "warehouse_stock");
    setManualRequestQty(1);
    setManualRequestNotes("");
  }

  function openRequestReceiveModal(request: PurchaseRequest) {
    const remaining = Math.max(1, request.quantity - (request.receivedQuantity ?? 0));
    setReceivingRequestId(request.id);
    setRequestReceiveDraft({ qty: remaining, unitCost: request.estimatedUnitCost, notes: request.notes });
  }

  function submitRequestReceive() {
    if (!receivingRequest) {
      return;
    }
    onReceivePurchaseRequest(receivingRequest.id, requestReceiveDraft.qty, requestReceiveDraft.unitCost, requestReceiveDraft.notes);
    setReceivingRequestId(null);
  }

  function openRequestEditModal(request: PurchaseRequest) {
    setEditingRequestId(request.id);
    setRequestEditDraft({
      quantity: request.quantity,
      preferredVendor: request.preferredVendor ?? "",
      poNumber: request.poNumber ?? "",
      expectedDate: request.expectedDate ?? "",
      estimatedUnitCost: request.estimatedUnitCost,
      status: request.status,
      projectName: request.projectName ?? "",
      procurementTrack: request.procurementTrack ?? "warehouse_stock",
      notes: request.notes,
    });
  }

  function submitRequestEdit() {
    if (!editingRequest) {
      return;
    }
    onUpdatePurchaseRequest(editingRequest.id, requestEditDraft);
    setEditingRequestId(null);
  }

  function exportPurchaseRequestQueue() {
    exportCsv(
      `ergon-purchase-requests-${new Date().toISOString().slice(0, 10)}.csv`,
      filteredPurchaseRequests.map((request) => ({
        request: request.requestNumber,
        sku: request.sku,
        item: request.itemName,
        quantity_ordered: request.quantity,
        quantity_received: request.receivedQuantity ?? 0,
        quantity_remaining: Math.max(0, request.quantity - (request.receivedQuantity ?? 0)),
        reason: request.reason,
        source: request.sourceRef ?? "",
        project: request.projectName ?? "",
        procurement_track: request.procurementTrack ?? "warehouse_stock",
        vendor: request.preferredVendor ?? "",
        po_number: request.poNumber ?? "",
        expected_date: request.expectedDate ?? "",
        unit_cost: request.estimatedUnitCost,
        status: request.status,
        notes: request.notes,
      })),
    );
  }

  return (
    <div className="content-grid purchasing-layout">
      <section className="metric-grid">
        <Metric icon={<ShoppingCart size={20} />} label="Recent Orders" value={String(purchaseOrders.length)} />
        <Metric icon={<DollarSign size={20} />} label="Captured Spend" value={money(totalSpend)} />
        <Metric icon={<FileText size={20} />} label="Sales Tax" value={money(totalTax)} />
        <Metric icon={<ClipboardList size={20} />} label="Open Requests" value={String(activeRequests.length + openOrders)} />
      </section>

      <TaskMiniPanel
        title="Procurement Tasks"
        tasks={tasks.filter((task) => task.section === "purchasing")}
        taskActivity={taskActivity}
        teamMembers={teamMembers}
        projectSites={projectSites}
        section="purchasing"
        isInternal
        hideAdd
        onCreate={onCreateTask}
        onUpdate={onUpdateTask}
        onDelete={onDeleteTask}
        onOpenFull={onOpenTasksView}
      />

      <section className="panel wide">
        <div className="panel-title-row">
          <div>
            <h2>Purchase Request Queue</h2>
            <p>Buying work created from low stock, planned builds, and future manual requests.</p>
          </div>
          <div className="action-row">
            <button className="secondary-action" type="button" onClick={exportPurchaseRequestQueue} disabled={filteredPurchaseRequests.length === 0}><FileText size={16} /> Export CSV</button>
            <button className="secondary-action" type="button" onClick={onQueueReorderRequests} disabled={lowStock.length === 0}><Plus size={16} /> Queue Reorders</button>
            <button className="primary-action" type="button" onClick={onQueuePlannedBuildShortageRequests} disabled={plannedBuilds === 0}><ShoppingCart size={16} /> Queue Build Shortages</button>
            <RequestTaskButton section="purchasing" teamMembers={teamMembers} projectSites={projectSites} onCreate={onCreateTask} />
          </div>
        </div>
        <div className="request-queue">
          <div className="request-filter-row">
            <label>
              Search
              <input value={requestFilters.text} onChange={(event) => setRequestFilters((current) => ({ ...current, text: event.target.value }))} placeholder="Request, SKU, part, vendor, build" />
            </label>
            <label>
              Status
              <select value={requestFilters.status} onChange={(event) => setRequestFilters((current) => ({ ...current, status: event.target.value }))}>
                <option>Open</option>
                <option>All</option>
                <option>Draft</option>
                <option>Need Quote</option>
                <option>Ready to Order</option>
                <option>Ordered</option>
                <option>Received</option>
                <option>Cancelled</option>
              </select>
            </label>
            <label>
              Reason
              <select value={requestFilters.reason} onChange={(event) => setRequestFilters((current) => ({ ...current, reason: event.target.value }))}>
                <option>All</option>
                <option>Reorder Point</option>
                <option>Planned Build Shortage</option>
                <option>Project BOM</option>
                <option>Manual</option>
              </select>
            </label>
          </div>
          <div className="manual-request-row">
            <label>
              Manual request
              <select value={manualRequestPartRef} onChange={(event) => setManualRequestPartRef(event.target.value)}>
                {inventoryItems.filter((item) => !item.retired).map((item) => <option key={item.ref} value={item.ref}>{item.ref} - {item.name}</option>)}
              </select>
            </label>
            <label>
              Qty
              <input type="number" min={1} value={manualRequestQty} onChange={(event) => setManualRequestQty(Number(event.target.value))} />
            </label>
            <label>
              Project
              <select value={manualRequestProject} onChange={(event) => setManualRequestProject(event.target.value)}>
                <option value="">Warehouse stock</option>
                {projectSites.map((project) => <option key={project.ref} value={project.name}>{project.ref} - {project.name}</option>)}
              </select>
            </label>
            <label>
              Source path
              <select value={manualRequestTrack} onChange={(event) => setManualRequestTrack(event.target.value as NonNullable<PurchaseRequest["procurementTrack"]>)}>
                <option value="warehouse_stock">Receive into warehouse</option>
                <option value="direct_to_project">Direct to project</option>
              </select>
            </label>
            <label>
              Notes
              <input value={manualRequestNotes} onChange={(event) => setManualRequestNotes(event.target.value)} placeholder="Reason, vendor note, project, or quote detail" />
            </label>
            <button className="secondary-action" type="button" onClick={submitManualRequest}><Plus size={16} /> Add Request</button>
          </div>
          <div className="request-queue-head"><span>Request</span><span>Need</span><span>Source</span><span>Est.</span><span>Status</span><span></span></div>
          {filteredPurchaseRequests.slice(0, 14).map((request) => (
            <div className={`request-row ${request.status === "Cancelled" ? "muted-row" : ""}`} key={request.id}>
              <span><strong>{request.itemName}</strong><small>{request.requestNumber} - {request.sku}</small></span>
              <span data-label="Need">{Math.max(0, request.quantity - (request.receivedQuantity ?? 0))}<small>of {request.quantity}</small></span>
              <span data-label="Source">{request.reason}<small>{request.projectName ? `${request.projectName} - ${request.procurementTrack === "direct_to_project" ? "direct to project" : "warehouse stock"}` : request.sourceRef ?? request.preferredVendor ?? "No source"}</small></span>
              <span data-label="Est.">{moneyExact(Math.max(0, request.quantity - (request.receivedQuantity ?? 0)) * request.estimatedUnitCost)}<small>{request.preferredVendor ?? "Vendor TBD"}</small></span>
              <span data-label="Status">
                <select value={request.status} onChange={(event) => onUpdatePurchaseRequestStatus(request.id, event.target.value as PurchaseRequest["status"])}>
                  <option>Draft</option>
                  <option>Need Quote</option>
                  <option>Ready to Order</option>
                  <option>Ordered</option>
                  {request.status === "Received" && <option>Received</option>}
                  <option>Cancelled</option>
                </select>
              </span>
              <span className="table-actions">
                <button className="table-action secondary-table-action" type="button" onClick={() => openRequestEditModal(request)}>Edit</button>
                <button className="table-action" type="button" onClick={() => openRequestReceiveModal(request)} disabled={request.status === "Cancelled" || request.status === "Received"}>Receive</button>
                <button className="table-action secondary-table-action" type="button" onClick={() => onCancelPurchaseRequest(request.id)} disabled={request.status === "Cancelled" || request.status === "Received"}>Cancel</button>
              </span>
            </div>
          ))}
          {purchaseRequests.length === 0 && <div className="empty-compact-state">No purchase requests yet. Queue reorder or build shortages to start the buying list.</div>}
          {purchaseRequests.length > 0 && filteredPurchaseRequests.length === 0 && <div className="empty-compact-state">No purchase requests match the current filters.</div>}
        </div>
      </section>
      {receivingRequest && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel receive-request-panel" role="dialog" aria-modal="true" aria-labelledby="receive-request-title">
            <div className="modal-header">
              <div>
                <h2 id="receive-request-title">Receive Purchase Request</h2>
                <p>{receivingRequest.requestNumber} - {receivingRequest.itemName}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setReceivingRequestId(null)} aria-label="Close receive request">x</button>
            </div>
            <div className="receive-request-summary">
              <span>Ordered {receivingRequest.quantity}</span>
              <span>Received {receivingRequest.receivedQuantity ?? 0}</span>
              <strong>Remaining {receivingRemaining}</strong>
            </div>
            <div className="bom-modal-grid">
              <label>Quantity received<input type="number" min={1} max={receivingRemaining || 1} value={requestReceiveDraft.qty} onChange={(event) => setRequestReceiveDraft((current) => ({ ...current, qty: Number(event.target.value) }))} /></label>
              <label>Unit cost<input type="number" min={0} step="0.01" value={requestReceiveDraft.unitCost} onChange={(event) => setRequestReceiveDraft((current) => ({ ...current, unitCost: Number(event.target.value) }))} /></label>
              <label className="span-2">Receiving notes<input value={requestReceiveDraft.notes} onChange={(event) => setRequestReceiveDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Packing slip, shipment note, exception, or receiving detail" /></label>
            </div>
            <div className="source-file"><Truck size={16} /><span>{receivingRequest.procurementTrack === "direct_to_project" ? "Posting this receipt assigns material to the project and does not increase warehouse stock." : "Posting this receipt updates inventory stock and logs a receive movement against the request number."}</span></div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setReceivingRequestId(null)}>Cancel</button>
              <button className="primary-action" type="button" onClick={submitRequestReceive} disabled={receivingRemaining <= 0}>Post Receipt</button>
            </div>
          </section>
        </div>
      )}
      {editingRequest && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel purchase-request-edit-panel" role="dialog" aria-modal="true" aria-labelledby="edit-request-title">
            <div className="modal-header">
              <div>
                <h2 id="edit-request-title">Edit Purchase Request</h2>
                <p>{editingRequest.requestNumber} - {editingRequest.sku} - {editingRequest.itemName}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setEditingRequestId(null)} aria-label="Close purchase request editor">x</button>
            </div>
            <div className="request-edit-summary">
              <span>{editingRequest.reason}</span>
              <span>{editingRequest.projectName ?? editingRequest.sourceRef ?? "No build/project source"}</span>
              <strong>{Math.max(0, editingRequest.quantity - (editingRequest.receivedQuantity ?? 0))} remaining</strong>
            </div>
            <div className="bom-modal-grid">
              <label>Quantity ordered<input type="number" min={editingRequest.receivedQuantity ?? 0} value={requestEditDraft.quantity} onChange={(event) => setRequestEditDraft((current) => ({ ...current, quantity: Number(event.target.value) }))} /></label>
              <label>Status<select value={requestEditDraft.status} onChange={(event) => setRequestEditDraft((current) => ({ ...current, status: event.target.value as PurchaseRequest["status"] }))}><option>Draft</option><option>Need Quote</option><option>Ready to Order</option><option>Ordered</option><option>Received</option><option>Cancelled</option></select></label>
              <label>Vendor<input value={requestEditDraft.preferredVendor} onChange={(event) => setRequestEditDraft((current) => ({ ...current, preferredVendor: event.target.value }))} placeholder="Vendor or source" /></label>
              <label>Unit cost<input type="number" min={0} step="0.01" value={requestEditDraft.estimatedUnitCost} onChange={(event) => setRequestEditDraft((current) => ({ ...current, estimatedUnitCost: Number(event.target.value) }))} /></label>
              <label>Project<select value={requestEditDraft.projectName} onChange={(event) => setRequestEditDraft((current) => ({ ...current, projectName: event.target.value }))}><option value="">Warehouse stock</option>{projectSites.map((project) => <option key={project.ref} value={project.name}>{project.ref} - {project.name}</option>)}</select></label>
              <label>Source path<select value={requestEditDraft.procurementTrack} onChange={(event) => setRequestEditDraft((current) => ({ ...current, procurementTrack: event.target.value as NonNullable<PurchaseRequest["procurementTrack"]> }))}><option value="warehouse_stock">Receive into warehouse</option><option value="direct_to_project">Direct to project</option></select></label>
              <label>PO number<input value={requestEditDraft.poNumber} onChange={(event) => setRequestEditDraft((current) => ({ ...current, poNumber: event.target.value }))} placeholder="PO, quote, or order number" /></label>
              <label>Expected date<input type="date" value={requestEditDraft.expectedDate} onChange={(event) => setRequestEditDraft((current) => ({ ...current, expectedDate: event.target.value }))} /></label>
              <label className="span-2">Notes<textarea value={requestEditDraft.notes} onChange={(event) => setRequestEditDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Vendor response, substitutions, purchasing notes, delivery details." /></label>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setEditingRequestId(null)}>Cancel</button>
              <button className="primary-action" type="button" onClick={submitRequestEdit}>Save Request</button>
            </div>
          </section>
        </div>
      )}

      <section className="panel wide">
        <PanelHeader title="Upload Procurement Document" label="Assign a PDF or receipt to a project before review" />
        <div className="upload-layout">
          <label className="upload-drop">
            <Upload size={24} />
            <strong>Choose document</strong>
            <span>PDF invoices, order confirmations, packing slips, or receipts</span>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" multiple onChange={handleDocumentSelect} />
          </label>
          <div className="upload-controls">
            <label>
              Project
              <select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)}>
                {documentProjects.map((project) => (
                  <option key={project} value={project}>{project}</option>
                ))}
              </select>
            </label>
            <div className="drive-card">
              <FolderOpen size={18} />
              <div>
                <strong>Future Google Drive backup</strong>
                <span>Documents can later be copied into the selected project folder automatically.</span>
              </div>
            </div>
          </div>
        </div>
        <div className="document-queue">
          {(activeProjectDocuments.length ? activeProjectDocuments : purchaseOrders.slice(0, 3).map((order, index) => ({
            id: `sample-${index}`,
            name: order.sourceFile,
            project: order.projectRef,
            size: 0,
            status: "Ready to review" as const,
            type: "Procurement" as const,
            storage: "Browser" as const,
            uploadedAt: "",
            uploadedByEmail: "",
          }))).map((doc) => (
            <div className="document-row" key={`${doc.id}-${doc.name}`}>
              <div>
                <strong>{doc.name}</strong>
                <span>{doc.project}{doc.size ? ` - ${formatBytes(doc.size)}` : " - imported sample"}{doc.storage ? ` - ${doc.storage}` : ""}</span>
                <small>{doc.id.startsWith("sample-") ? "Sample row from imported order data" : formatDocumentProvenance(doc as UploadedDoc)}</small>
              </div>
              <select value={doc.status} onChange={(event) => updateProjectDocumentStatus(doc.id, event.target.value as UploadedDoc["status"])} disabled={doc.id.startsWith("sample-")}>
                <option>Uploaded</option>
                <option>Ready to review</option>
                <option>Backed up</option>
                <option>Archived</option>
              </select>
              {"storagePath" in doc && doc.storagePath && (
                <button className="secondary-action mini-action" type="button" onClick={() => onDownloadDocument(doc as UploadedDoc)}>Download</button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-title-row">
          <PanelHeader title="Imported Purchase Queue" label="Vendor orders organized by vendor, project reference, and status" />
          <button className="secondary-action mini-action" type="button" onClick={() => setShowPoForm((current) => !current)}>
            {showPoForm ? "Cancel" : "New Purchase Order"}
          </button>
        </div>
        {showPoForm && (
          <div className="inline-form">
            <div className="form-grid">
              <label>Order # <input value={poDraft.number} onChange={(event) => setPoDraft((current) => ({ ...current, number: event.target.value }))} placeholder="PO or order number" /></label>
              <label>Vendor <input value={poDraft.vendor} onChange={(event) => setPoDraft((current) => ({ ...current, vendor: event.target.value }))} list="po-vendor-options" placeholder="Vendor name" /></label>
              <datalist id="po-vendor-options">
                {poVendorOptions.map((vendor) => <option key={vendor} value={vendor} />)}
              </datalist>
              <label>Date <input type="date" value={poDraft.date} onChange={(event) => setPoDraft((current) => ({ ...current, date: event.target.value }))} /></label>
              <label>Project Ref <input value={poDraft.projectRef} onChange={(event) => setPoDraft((current) => ({ ...current, projectRef: event.target.value }))} list="po-project-options" placeholder="Project name" /></label>
              <datalist id="po-project-options">
                {projectSites.map((project) => <option key={project.name} value={project.name} />)}
              </datalist>
              <label>Status
                <select value={poDraft.status} onChange={(event) => setPoDraft((current) => ({ ...current, status: event.target.value as PurchaseOrder["status"] }))}>
                  <option>Imported</option>
                  <option>In Processing</option>
                  <option>On Hold</option>
                </select>
              </label>
              <label>Ship To <input value={poDraft.shipTo} onChange={(event) => setPoDraft((current) => ({ ...current, shipTo: event.target.value }))} /></label>
              <label>Payment Note <input value={poDraft.paymentNote} onChange={(event) => setPoDraft((current) => ({ ...current, paymentNote: event.target.value }))} /></label>
              <label>Source File <input value={poDraft.sourceFile} onChange={(event) => setPoDraft((current) => ({ ...current, sourceFile: event.target.value }))} placeholder="Attached PDF name (optional)" /></label>
              <label>Tax <input type="number" min={0} step="0.01" value={poDraft.tax} onChange={(event) => setPoDraft((current) => ({ ...current, tax: Number(event.target.value) || 0 }))} /></label>
              <label>Shipping <input type="number" min={0} step="0.01" value={poDraft.shipping} onChange={(event) => setPoDraft((current) => ({ ...current, shipping: Number(event.target.value) || 0 }))} /></label>
            </div>
            <div className="line-list">
              {poDraft.lines.map((line, index) => (
                <div className="line-item" key={index}>
                  <input value={line.name} onChange={(event) => updatePoLine(index, { name: event.target.value })} placeholder="Item name" />
                  <select value={line.category} onChange={(event) => updatePoLine(index, { category: event.target.value as PurchaseLineCategory })}>
                    <option>Compute</option>
                    <option>Storage</option>
                    <option>Network</option>
                    <option>Power</option>
                    <option>Enclosure</option>
                    <option>Hardware</option>
                    <option>Rack</option>
                    <option>Other</option>
                  </select>
                  <input type="number" min={1} value={line.qty} onChange={(event) => updatePoLine(index, { qty: Number(event.target.value) || 0 })} aria-label="Quantity" />
                  <input type="number" min={0} step="0.01" value={line.unitCost} onChange={(event) => updatePoLine(index, { unitCost: Number(event.target.value) || 0 })} aria-label="Unit cost" />
                  <b>{moneyExact(line.qty * line.unitCost)}</b>
                  {poDraft.lines.length > 1 && <button className="secondary-action mini-action" type="button" onClick={() => removePoLine(index)}>Remove</button>}
                </div>
              ))}
              <button className="secondary-action mini-action" type="button" onClick={addPoLine}>Add Line</button>
            </div>
            <div className="order-totals">
              <span>Subtotal {moneyExact(poSubtotal)}</span>
              <span>Tax {moneyExact(poDraft.tax)}</span>
              <span>Shipping {moneyExact(poDraft.shipping)}</span>
              <strong>{moneyExact(poSubtotal + poDraft.tax + poDraft.shipping)}</strong>
            </div>
            <button className="primary-action" type="button" onClick={submitPurchaseOrder} disabled={!poDraft.number.trim() || !poDraft.vendor.trim()}>Save Purchase Order</button>
          </div>
        )}
        <div className="po-table-scroll">
        <table>
          <thead>
            <tr><th>Order</th><th>Vendor</th><th>Project Ref</th><th>Status</th><th>Lines</th><th>Total</th></tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr key={po.id}>
                <td><strong>{po.number}</strong><small>{formatPoDate(po.date)}</small></td>
                <td>{po.vendor}</td>
                <td>{po.projectRef}</td>
                <td>
                  <select className={`status-select ${po.status === "On Hold" ? "warn" : po.status === "Imported" ? "ok" : ""}`} value={po.status} onChange={(event) => onUpdatePurchaseOrderStatus(po.id, event.target.value as PurchaseOrder["status"])}>
                    <option>Imported</option>
                    <option>In Processing</option>
                    <option>On Hold</option>
                  </select>
                </td>
                <td>{po.lines.reduce((sum, line) => sum + line.qty, 0)} units <small>{po.sourceFile}</small></td>
                <td>{moneyExact(po.total)}</td>
              </tr>
            ))}
            {purchaseOrders.length === 0 && (
              <tr><td colSpan={6} className="empty-compact-state">No purchase orders yet. Add one above.</td></tr>
            )}
          </tbody>
        </table>
        </div>

        <div className="mobile-card-list">
          {purchaseOrders.map((po) => (
            <div key={po.id} className="mobile-card">
              <span className="mobile-card-row">
                <span className="mobile-card-title">
                  <strong>{po.number}</strong>
                  <small className="muted">{po.vendor} &middot; {po.projectRef || "No project ref"}</small>
                </span>
                <b>{moneyExact(po.total)}</b>
              </span>
              <span className="mobile-card-meta">{formatPoDate(po.date)} &middot; {po.lines.reduce((sum, line) => sum + line.qty, 0)} units{po.sourceFile ? ` · ${po.sourceFile}` : ""}</span>
              <select className={`status-select ${po.status === "On Hold" ? "warn" : po.status === "Imported" ? "ok" : ""}`} value={po.status} onChange={(event) => onUpdatePurchaseOrderStatus(po.id, event.target.value as PurchaseOrder["status"])}>
                <option>Imported</option>
                <option>In Processing</option>
                <option>On Hold</option>
              </select>
            </div>
          ))}
          {purchaseOrders.length === 0 && <div className="empty-compact-state">No purchase orders yet. Add one above.</div>}
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Spend By Project" label="Total spend grouped by project reference" />
        <div className="stack">
          {projectSpend.map(([project, total]) => (
            <div className="row-card" key={project}>
              <div>
                <strong>{project}</strong>
                <span>{purchaseOrders.filter((order) => order.projectRef === project).length} orders</span>
              </div>
              <b>{moneyExact(total)}</b>
            </div>
          ))}
          {projectSpend.length === 0 && <div className="empty-compact-state">No purchase orders yet.</div>}
        </div>
      </section>

      <section className="panel full">
        <PanelHeader title="Order Line Items" label="Grouped by purchase order" />
        <div className="order-grid">
          {purchaseOrders.map((order) => (
            <article className="order-card" key={order.id}>
              <div className="order-card-header">
                <div>
                  <h3>{order.vendor}</h3>
                  <p>{order.number} - {order.projectRef}</p>
                </div>
                <span className={`status ${order.status === "On Hold" ? "warn" : order.status === "Imported" ? "ok" : ""}`}>{order.status}</span>
              </div>
              <div className="order-meta">
                <span>{formatPoDate(order.date)}</span>
                <span>{order.shipTo}</span>
                <span>{order.paymentNote}</span>
              </div>
              <div className="line-list">
                {order.lines.map((line, index) => (
                  <div className="line-item" key={`${order.id}-${line.name}-${index}`}>
                    <div>
                      <strong>{line.name}</strong>
                      <span>{line.category} - Qty {line.qty} at {moneyExact(line.unitCost)}</span>
                    </div>
                    <b>{moneyExact(lineTotal(line))}</b>
                  </div>
                ))}
                {order.lines.length === 0 && <div className="empty-compact-state">No line items.</div>}
              </div>
              <div className="order-totals">
                <span>Subtotal {moneyExact(order.subtotal)}</span>
                <span>Tax {moneyExact(order.tax)}</span>
                <strong>{moneyExact(order.total)}</strong>
              </div>
            </article>
          ))}
          {purchaseOrders.length === 0 && <div className="empty-compact-state">No purchase orders yet.</div>}
        </div>
      </section>
    </div>
  );
}

function Inventory({
  roleMode,
  inventoryItems,
  lowStock,
  projectSites,
  deviceRecipes,
  setDeviceRecipes,
  buildTransactions,
  inventoryMovements,
  onAddItem,
  onUpdateItem,
  onReceiveStock,
  onAdjustStock,
  onTransferToProject,
  onPlanBuild,
  onBuildInventoryUnit,
  onUndoBuildTransaction,
  onUpdateBuildStage,
  onCancelPlannedBuild,
  onQueueBuildShortageRequests,
  tasks,
  taskActivity,
  teamMembers,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onOpenTasksView,
  searchFocus,
  purchaseRequests,
  onOpenPurchasing,
}: {
  roleMode: RoleMode;
  inventoryItems: Part[];
  lowStock: Part[];
  projectSites: ProjectSite[];
  deviceRecipes: BuildRecipe[];
  setDeviceRecipes: Dispatch<SetStateAction<BuildRecipe[]>>;
  buildTransactions: BuildTransaction[];
  inventoryMovements: InventoryMovement[];
  onAddItem: (part: Part) => void;
  onUpdateItem: (ref: string, part: Part) => void;
  onReceiveStock: (partRef: string, qty: number, unitCost: number, poNumber: string, notes: string) => void;
  onAdjustStock: (partRef: string, nextQty: number, notes: string) => void;
  onTransferToProject: (partRef: string, projectName: string, qty: number, notes: string) => void;
  onPlanBuild: (recipe: BuildRecipe, qty: number) => void;
  onBuildInventoryUnit: (recipe: BuildRecipe, qty: number, plannedBuildId?: string) => void;
  onUndoBuildTransaction: (buildId: string) => void;
  onUpdateBuildStage: (buildId: string, stage: NonNullable<BuildTransaction["stage"]>) => void;
  onCancelPlannedBuild: (buildId: string) => void;
  onQueueBuildShortageRequests: (buildId: string) => void;
  tasks: EOTask[];
  taskActivity: TaskActivityEntry[];
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">) => Promise<boolean>;
  onUpdateTask: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => Promise<boolean>;
  onDeleteTask: (id: string) => void;
  onOpenTasksView: () => void;
  searchFocus?: { term: string; token: number } | null;
  purchaseRequests: PurchaseRequest[];
  onOpenPurchasing: (term: string) => void;
}) {
  const emptyItemDraft: Part = {
    ref: nextSkuRef(inventoryItems),
    name: "",
    description: "",
    manufacturer: "",
    category: "Base",
    cost: 0,
    stock: 0,
    reorderPoint: 0,
    imageUrl: "",
    barcode: "",
    purchaseUrls: [],
    priceHistory: [],
    tags: [],
    retired: false,
  };
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItemRef, setEditingItemRef] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState<Part>(emptyItemDraft);
  const [previewItem, setPreviewItem] = useState<Part | null>(null);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustModalMode, setAdjustModalMode] = useState<"count" | "transfer">("count");
  const [adjustLockedPart, setAdjustLockedPart] = useState<Part | null>(null);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showBuildConfirm, setShowBuildConfirm] = useState(false);
  const [buildConfirmAck, setBuildConfirmAck] = useState(false);
  const [buildConfirmPlannedId, setBuildConfirmPlannedId] = useState<string | undefined>(undefined);
  const [workOrderBuildId, setWorkOrderBuildId] = useState<string | null>(null);
  const [inventoryTab, setInventoryTab] = useState<"parts" | "finished">("parts");
  const [filters, setFilters] = useState({ ref: "", part: "", category: "All", manufacturer: "", status: "All" });
  useEffect(() => {
    if (!searchFocus) {
      return;
    }
    const matched = inventoryItems.find((part) => part.ref === searchFocus.term);
    setInventoryTab(matched?.category === "Build" ? "finished" : "parts");
    setFilters({ ref: searchFocus.term, part: "", category: "All", manufacturer: "", status: "All" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFocus?.token]);
  const [skuScan, setSkuScan] = useState("");
  const [scanStatus, setScanStatus] = useState("Scan or enter a SKU to pull up the item.");
  const [buildDraft, setBuildDraft] = useState({ recipeName: deviceRecipes.find((recipe) => !recipe.retired)?.name ?? deviceRecipes[0]?.name ?? "", qty: 1 });
  const [newComponentDraft, setNewComponentDraft] = useState({ itemName: "", qty: 1 });
  const [receiveDraft, setReceiveDraft] = useState({
    partRef: inventoryItems[0]?.ref ?? "",
    qty: 1,
    unitCost: 0,
    poNumber: "",
    notes: "",
  });
  const [adjustDraft, setAdjustDraft] = useState({
    partRef: inventoryItems[0]?.ref ?? "",
    nextQty: inventoryItems[0]?.stock ?? 0,
    notes: "",
  });
  const [transferDraft, setTransferDraft] = useState({
    partRef: inventoryItems[0]?.ref ?? "",
    projectName: projectSites[0]?.name ?? "",
    qty: 1,
    notes: "",
  });
  const receiveItem = inventoryItems.find((part) => part.ref === receiveDraft.partRef);
  const adjustItem = inventoryItems.find((part) => part.ref === adjustDraft.partRef);
  const sortedDraftHistory = [...(itemDraft.priceHistory ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const selectedBuildRecipe = deviceRecipes.find((recipe) => recipe.name === buildDraft.recipeName) ?? deviceRecipes.find((recipe) => !recipe.retired) ?? deviceRecipes[0];
  const buildComponentRows = selectedBuildRecipe.components.map((component) => {
    const part = inventoryItems.find((item) => item.name === component.itemName);
    const required = component.qty * Math.max(1, Math.round(Number(buildDraft.qty) || 1));
    const available = part?.retired ? 0 : part?.stock ?? 0;
    return { ...component, part, required, available, shortage: Math.max(0, required - available) };
  });
  const buildHasShortage = buildComponentRows.some((component) => component.shortage > 0);
  const workOrderBuild = buildTransactions.find((build) => build.id === workOrderBuildId) ?? null;
  const workOrderRecipe = workOrderBuild ? deviceRecipes.find((recipe) => recipe.outputName === workOrderBuild.equipmentName || recipe.name === workOrderBuild.equipmentName) : undefined;
  const workOrderRows = workOrderBuild && workOrderRecipe
    ? workOrderRecipe.components.map((component) => {
        const part = inventoryItems.find((item) => item.name === component.itemName);
        const required = component.qty * workOrderBuild.quantityBuilt;
        const available = part && !part.retired ? part.stock : 0;
        return { component, part, required, available, shortage: Math.max(0, required - available) };
      })
    : [];
  const workOrderHasShortage = workOrderRows.some((row) => row.shortage > 0);
  const equipmentOptions = deviceRecipes.filter((recipe) => !recipe.retired || recipe.name === selectedBuildRecipe.name);
  const manufacturedEquipmentRows = deviceRecipes.map((recipe) => {
    const finishedPart = inventoryItems.find((part) => part.name === recipe.outputName && part.category === "Build");
    const finished = finishedPart?.stock ?? 0;
    const buildable = recipe.components.length
      ? Math.min(
          ...recipe.components.map((component) => {
            const part = inventoryItems.find((item) => item.name === component.itemName);
            return part && !part.retired ? Math.floor(part.stock / component.qty) : 0;
          }),
        )
      : 0;
    return { recipe, finished, buildable };
  });
  const roleCopy: Record<RoleMode, { title: string; body: string }> = {
    warehouse: { title: "Warehouse workbench", body: "Scan SKUs, receive stock, adjust cycle counts, and transfer parts to projects." },
    purchasing: { title: "Procurement workbench", body: "Watch reorder items, receive against POs, and keep vendor costs current." },
    pm: { title: "PM workbench", body: "Transfer stock to projects and review project allocation history from the ledger." },
    manager: { title: "Manager workbench", body: "Review inventory value, build readiness, shortages, and recent transactions." },
    sales: { title: "Inventory (view)", body: "Reference stock levels while scoping a quote. Ask an Admin or Manager for write access if you need it." },
    engineering: { title: "Engineering workbench", body: "Check part availability and transfer stock to projects during install." },
    product_development: { title: "Inventory (view)", body: "Reference stock and build readiness for planning. Ask an Admin or Manager for write access if you need it." },
    implementation: { title: "Implementation workbench", body: "Transfer stock to projects and confirm parts are ready before install." },
    support: { title: "Inventory (view)", body: "Reference stock levels while resolving a support case. Ask an Admin or Manager for write access if you need it." },
    marketing: { title: "Inventory (view)", body: "Reference stock levels for reporting. Ask an Admin or Manager for write access if you need it." },
  };
  const rolePermissions: Record<RoleMode, string[]> = {
    warehouse: ["Receive", "Adjust", "Transfer", "Scan"],
    purchasing: ["Requests", "Receive PO", "Costs", "Vendors"],
    pm: ["Projects", "BOM", "Transfers", "Docs"],
    manager: ["Reports", "Builds", "Ledger", "Approvals"],
    sales: ["View only"],
    engineering: ["Transfer", "Scan"],
    product_development: ["View only"],
    implementation: ["Transfer", "Scan"],
    support: ["View only"],
    marketing: ["View only"],
  };
  const filteredInventoryItems = inventoryItems.filter((part) => {
    const status = part.retired ? "Retired" : part.stock <= part.reorderPoint ? "Reorder" : "Healthy";
    const tabMatch = inventoryTab === "finished" ? part.category === "Build" : part.category !== "Build";
    return (
      tabMatch &&
      part.ref.toLowerCase().includes(filters.ref.toLowerCase()) &&
      `${part.name} ${part.description}`.toLowerCase().includes(filters.part.toLowerCase()) &&
      (filters.category === "All" || part.category === filters.category) &&
      part.manufacturer.toLowerCase().includes(filters.manufacturer.toLowerCase()) &&
      (filters.status === "All" || status === filters.status)
    );
  });

  function openAddItemModal() {
    setEditingItemRef(null);
    setItemDraft({ ...emptyItemDraft, ref: nextSkuRef(inventoryItems) });
    setShowItemModal(true);
  }

  function openEditItemModal(part: Part) {
    setEditingItemRef(part.ref);
    setItemDraft({
      ...part,
      imageUrl: part.imageUrl ?? "",
      barcode: part.barcode ?? "",
      purchaseUrls: [...(part.purchaseUrls ?? [])],
      priceHistory: [...(part.priceHistory ?? [])],
      tags: [...(part.tags ?? [])],
    });
    setShowItemModal(true);
  }

  function toggleItemTag(tag: string) {
    setItemDraft((current) => {
      const currentTags = current.tags ?? [];
      return {
        ...current,
        tags: currentTags.includes(tag) ? currentTags.filter((itemTag) => itemTag !== tag) : [...currentTags, tag],
      };
    });
  }

  function addPurchaseUrl() {
    setItemDraft((current) => ({
      ...current,
      purchaseUrls: [...(current.purchaseUrls ?? []), { id: Date.now(), label: "", url: "" }],
    }));
  }

  function updatePurchaseUrl(id: number, field: keyof PurchaseUrl, value: string) {
    setItemDraft((current) => ({
      ...current,
      purchaseUrls: (current.purchaseUrls ?? []).map((source) => (source.id === id ? { ...source, [field]: value } : source)),
    }));
  }

  function removePurchaseUrl(id: number) {
    setItemDraft((current) => ({
      ...current,
      purchaseUrls: (current.purchaseUrls ?? []).filter((source) => source.id !== id),
    }));
  }

  function addPriceHistory() {
    setItemDraft((current) => ({
      ...current,
      priceHistory: [
        ...(current.priceHistory ?? []),
        { id: Date.now(), date: new Date().toISOString().slice(0, 10), vendor: current.manufacturer || "TBD", unitCost: Number(current.cost) || 0, notes: "" },
      ],
    }));
  }

  function updatePriceHistory(id: number, field: keyof PriceHistoryEntry, value: string | number) {
    setItemDraft((current) => ({
      ...current,
      priceHistory: (current.priceHistory ?? []).map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)),
    }));
  }

  function removePriceHistory(id: number) {
    setItemDraft((current) => ({
      ...current,
      priceHistory: (current.priceHistory ?? []).filter((entry) => entry.id !== id),
    }));
  }

  function uploadItemImage(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setItemDraft((current) => ({ ...current, imageUrl: String(reader.result ?? "") }));
    };
    reader.readAsDataURL(file);
  }

  function saveItem() {
    const normalized: Part = {
      ...itemDraft,
      ref: itemDraft.ref.trim() || nextSkuRef(inventoryItems),
      name: itemDraft.name.trim() || "New Inventory Item",
      description: itemDraft.description.trim(),
      manufacturer: itemDraft.manufacturer.trim() || "TBD",
      cost: Math.max(0, Number(itemDraft.cost) || 0),
      stock: Math.max(0, Math.round(Number(itemDraft.stock) || 0)),
      reorderPoint: Math.max(0, Math.round(Number(itemDraft.reorderPoint) || 0)),
      imageUrl: itemDraft.imageUrl?.trim() ?? "",
      barcode: itemDraft.barcode?.trim() ?? "",
      purchaseUrls: (itemDraft.purchaseUrls ?? [])
        .map((source) => ({ ...source, label: source.label.trim(), url: source.url.trim() }))
        .filter((source) => source.label || source.url)
        .map((source) => ({ ...source, label: source.label || "Purchase source" })),
      priceHistory: (itemDraft.priceHistory ?? [])
        .map((entry) => ({
          ...entry,
          date: entry.date || new Date().toISOString().slice(0, 10),
          vendor: entry.vendor.trim() || "TBD",
          unitCost: Math.max(0, Number(entry.unitCost) || 0),
          notes: entry.notes.trim(),
        }))
        .filter((entry) => entry.vendor || entry.unitCost > 0)
        .sort((a, b) => a.date.localeCompare(b.date)),
      tags: [...new Set(itemDraft.tags ?? [])],
      retired: itemDraft.retired ?? false,
    };

    if (editingItemRef) {
      onUpdateItem(editingItemRef, normalized);
    } else {
      onAddItem(normalized);
    }

    setShowItemModal(false);
  }

  function exportVisibleInventory() {
    exportCsv(
      `ergon-inventory-${inventoryTab}-${new Date().toISOString().slice(0, 10)}.csv`,
      filteredInventoryItems.map((part) => ({
        sku: part.ref,
        name: part.name,
        description: part.description,
        category: part.category,
        manufacturer: part.manufacturer,
        stock: part.stock,
        reorder_point: part.reorderPoint,
        unit_cost: part.cost,
        status: part.retired ? "Retired" : part.stock <= part.reorderPoint ? "Reorder" : "Healthy",
        tags: (part.tags ?? []).join("; "),
        barcode: part.barcode ?? "",
      })),
    );
  }

  function exportMovementLedger() {
    exportCsv(
      `ergon-inventory-movements-${new Date().toISOString().slice(0, 10)}.csv`,
      inventoryMovements.map((movement) => ({
        date: movement.createdAt,
        type: movement.type,
        sku: movement.sku,
        item: movement.itemName,
        quantity: movement.quantity,
        before: movement.quantityBefore,
        after: movement.quantityAfter,
        project: movement.projectName ?? "",
        po: movement.poNumber ?? "",
        build: movement.buildNumber ?? "",
        source: movement.source,
        notes: movement.notes,
        performedBy: movement.createdByEmail ?? "",
      })),
    );
  }

  function toggleItemRetired() {
    setItemDraft((current) => ({ ...current, retired: !current.retired }));
  }

  function findPendingRequest(part: Part) {
    return purchaseRequests.find((request) => request.sku === part.ref && request.status === "Ordered");
  }

  function openReceiveModal(part?: Part) {
    const target = part ?? inventoryItems.find((item) => !item.retired) ?? inventoryItems[0];
    if (!target) {
      return;
    }
    const pending = findPendingRequest(target);
    setReceiveDraft({
      partRef: target.ref,
      qty: pending ? Math.max(1, pending.quantity - (pending.receivedQuantity ?? 0)) : 1,
      unitCost: pending ? pending.estimatedUnitCost : target.cost,
      poNumber: pending?.poNumber ?? "",
      notes: "",
    });
    setShowReceiveModal(true);
  }

  function saveReceive() {
    const part = inventoryItems.find((item) => item.ref === receiveDraft.partRef);
    if (!part || part.retired) {
      return;
    }

    onReceiveStock(part.ref, receiveDraft.qty, Number(receiveDraft.unitCost) || 0, receiveDraft.poNumber, receiveDraft.notes);
    setShowReceiveModal(false);
  }

  function openAdjustModal(part?: Part) {
    const target = part ?? inventoryItems.find((item) => !item.retired) ?? inventoryItems[0];
    if (!target) {
      return;
    }
    setAdjustDraft({
      partRef: target.ref,
      nextQty: target.stock,
      notes: "",
    });
    setTransferDraft({
      partRef: target.ref,
      projectName: projectSites[0]?.name ?? "",
      qty: 1,
      notes: "",
    });
    setAdjustLockedPart(part ?? null);
    setAdjustModalMode("count");
    setShowAdjustModal(true);
  }

  function saveAdjust() {
    const part = inventoryItems.find((item) => item.ref === adjustDraft.partRef);
    if (!part || part.retired) {
      return;
    }

    onAdjustStock(part.ref, adjustDraft.nextQty, adjustDraft.notes);
    setShowAdjustModal(false);
  }

  function handleSkuScan() {
    const query = skuScan.trim().toLowerCase();
    const matched = inventoryItems.find((part) => part.ref.toLowerCase() === query || (part.barcode ?? "").toLowerCase() === query || part.name.toLowerCase().includes(query));
    if (!matched) {
      setScanStatus("No matching SKU or item name found.");
      return;
    }

    setInventoryTab(matched.category === "Build" ? "finished" : "parts");
    setFilters((current) => ({ ...current, ref: matched.ref, part: "", category: "All", manufacturer: "", status: "All" }));
    setScanStatus(`${matched.ref} loaded: ${matched.name}.`);
  }

  function saveTransfer() {
    const part = inventoryItems.find((item) => item.ref === transferDraft.partRef);
    if (!part || part.retired || !transferDraft.projectName || part.stock <= 0) {
      return;
    }

    onTransferToProject(part.ref, transferDraft.projectName, Math.max(1, Math.round(Number(transferDraft.qty) || 1)), transferDraft.notes);
    setShowAdjustModal(false);
  }

  function requestBuild(plannedBuildId?: string) {
    if (selectedBuildRecipe.retired || buildHasShortage || buildComponentRows.length === 0) {
      return;
    }

    setBuildConfirmAck(false);
    setBuildConfirmPlannedId(plannedBuildId);
    setShowBuildConfirm(true);
  }

  function planBuild() {
    if (selectedBuildRecipe.retired || buildComponentRows.length === 0) {
      return;
    }

    onPlanBuild(selectedBuildRecipe, Math.max(1, Math.round(Number(buildDraft.qty) || 1)));
  }

  function confirmBuild() {
    onBuildInventoryUnit(selectedBuildRecipe, Math.max(1, Math.round(Number(buildDraft.qty) || 1)), buildConfirmPlannedId);
    setShowBuildConfirm(false);
    setBuildConfirmPlannedId(undefined);
    setBuildConfirmAck(false);
  }

  function buildReadinessForTransaction(build: BuildTransaction) {
    const recipe = deviceRecipes.find((item) => item.outputName === build.equipmentName || item.name === build.equipmentName);
    if (!recipe) {
      return { recipe: undefined, hasShortage: true, message: "Equipment recipe not found." };
    }

    const hasShortage = recipe.components.some((component) => {
      const part = inventoryItems.find((item) => item.name === component.itemName);
      return !part || part.retired || part.stock < component.qty * build.quantityBuilt;
    });
    return {
      recipe,
      hasShortage,
      message: hasShortage ? "Parts short" : "Ready",
    };
  }

  function selectBuildRecipe(recipeName: string) {
    if (recipeName === "__create_new_device") {
      const nextIndex = deviceRecipes.filter((recipe) => recipe.name.startsWith("New Equipment")).length + 1;
      const nextName = `New Equipment ${nextIndex}`;
      setDeviceRecipes((current) => [
        ...current,
        {
          name: nextName,
          outputName: nextName,
          description: "",
          imageUrl: "",
          components: [],
          retired: false,
        },
      ]);
      setBuildDraft((current) => ({ ...current, recipeName: nextName }));
      return;
    }

    setBuildDraft((current) => ({ ...current, recipeName }));
  }

  function updateSelectedRecipe(fields: Partial<Pick<BuildRecipe, "outputName" | "description" | "imageUrl">>) {
    setDeviceRecipes((current) =>
      current.map((recipe) =>
        recipe.name === selectedBuildRecipe.name
          ? {
              ...recipe,
              ...fields,
              outputName: fields.outputName !== undefined ? fields.outputName : recipe.outputName,
            }
          : recipe,
      ),
    );
  }

  function toggleSelectedRecipeRetired() {
    setDeviceRecipes((current) =>
      current.map((recipe) => (recipe.name === selectedBuildRecipe.name ? { ...recipe, retired: !recipe.retired } : recipe)),
    );
  }

  function deleteSelectedRecipe() {
    if (deviceRecipes.length <= 1 || !window.confirm(`Delete ${selectedBuildRecipe.outputName}? Use retire if you need to keep this equipment type for history.`)) {
      return;
    }

    const remaining = deviceRecipes.filter((recipe) => recipe.name !== selectedBuildRecipe.name);
    setDeviceRecipes(remaining);
    setBuildDraft((current) => ({ ...current, recipeName: remaining.find((recipe) => !recipe.retired)?.name ?? remaining[0]?.name ?? "" }));
  }

  function uploadEquipmentImage(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateSelectedRecipe({ imageUrl: String(reader.result ?? "") });
    };
    reader.readAsDataURL(file);
  }

  function addComponentToDevice() {
    const selectedItem = inventoryItems.find((part) => part.name === newComponentDraft.itemName);
    if (!selectedItem) {
      return;
    }

    const addQty = Math.max(1, Math.round(Number(newComponentDraft.qty) || 1));
    setDeviceRecipes((current) =>
      current.map((recipe) => {
        if (recipe.name !== selectedBuildRecipe.name) {
          return recipe;
        }

        const existingComponent = recipe.components.find((component) => component.itemName === selectedItem.name);
        if (existingComponent) {
          return {
            ...recipe,
            components: recipe.components.map((component) => (component.itemName === selectedItem.name ? { ...component, qty: component.qty + addQty } : component)),
          };
        }

        return {
          ...recipe,
          components: [...recipe.components, { itemName: selectedItem.name, qty: addQty }],
        };
      }),
    );
    setNewComponentDraft({ itemName: "", qty: 1 });
  }

  function updateDeviceComponentItem(currentItemName: string, nextItemName: string) {
    setDeviceRecipes((current) =>
      current.map((recipe) => {
        if (recipe.name !== selectedBuildRecipe.name || currentItemName === nextItemName) {
          return recipe;
        }

        const currentComponent = recipe.components.find((component) => component.itemName === currentItemName);
        const existingComponent = recipe.components.find((component) => component.itemName === nextItemName);

        if (currentComponent && existingComponent) {
          return {
            ...recipe,
            components: recipe.components
              .filter((component) => component.itemName !== currentItemName)
              .map((component) => (component.itemName === nextItemName ? { ...component, qty: component.qty + currentComponent.qty } : component)),
          };
        }

        return { ...recipe, components: recipe.components.map((component) => (component.itemName === currentItemName ? { ...component, itemName: nextItemName } : component)) };
      }),
    );
  }

  function updateDeviceComponent(itemName: string, qty: number) {
    setDeviceRecipes((current) =>
      current.map((recipe) =>
        recipe.name === selectedBuildRecipe.name
          ? { ...recipe, components: recipe.components.map((component) => (component.itemName === itemName ? { ...component, qty: Math.max(1, Math.round(Number(qty) || 1)) } : component)) }
          : recipe,
      ),
    );
  }

  function removeDeviceComponent(itemName: string) {
    setDeviceRecipes((current) =>
      current.map((recipe) => (recipe.name === selectedBuildRecipe.name ? { ...recipe, components: recipe.components.filter((component) => component.itemName !== itemName) } : recipe)),
    );
  }

  const plannedBuildCount = buildTransactions.filter((build) => build.status === "planned").length;
  const inventoryValueTotal = inventoryItems.reduce((sum, part) => sum + part.stock * part.cost, 0);

  return (
    <div className="content-grid">
      <section className="metric-grid">
        <Metric icon={<Boxes size={20} />} label="Total SKUs" value={String(inventoryItems.length)} />
        <Metric icon={<Bell size={20} />} label="Low Stock" value={String(lowStock.length)} />
        <Metric icon={<DollarSign size={20} />} label="Inventory Value" value={money(inventoryValueTotal)} />
        <Metric icon={<Truck size={20} />} label="Planned Builds" value={String(plannedBuildCount)} />
      </section>

      <TaskMiniPanel
        title="Inventory Tasks"
        tasks={tasks.filter((task) => task.section === "inventory" || task.section === "warehouse")}
        taskActivity={taskActivity}
        teamMembers={teamMembers}
        projectSites={projectSites}
        section="inventory"
        isInternal
        hideAdd
        onCreate={onCreateTask}
        onUpdate={onUpdateTask}
        onDelete={onDeleteTask}
        onOpenFull={onOpenTasksView}
      />

      <section className="panel wide">
        <div className="panel-title-row">
          <div>
            <h2>Parts Inventory</h2>
            <p>{inventoryTab === "finished" ? "Finished manufactured equipment ready for projects" : "Procurement parts, components, and field hardware"}</p>
          </div>
          <div className="action-row">
            <button className="secondary-action" type="button" onClick={exportVisibleInventory} disabled={filteredInventoryItems.length === 0}><FileText size={16} /> Export CSV</button>
            <button className="secondary-action" type="button" onClick={() => openReceiveModal()}><Truck size={16} /> Receive Stock</button>
            <button className="secondary-action" type="button" onClick={() => openAdjustModal()}><ClipboardList size={16} /> Adjust Count</button>
            <button className="primary-action" type="button" onClick={openAddItemModal}><Plus size={17} /> Add New Item</button>
            <RequestTaskButton section="inventory" teamMembers={teamMembers} projectSites={projectSites} onCreate={onCreateTask} />
          </div>
        </div>
        <div className={`role-workbench ${roleMode}`}>
          <div>
            <strong>{roleCopy[roleMode].title}</strong>
            <span>{roleCopy[roleMode].body}</span>
          </div>
          <div className="role-permission-strip" aria-label={`${roleMode} permissions`}>
            {rolePermissions[roleMode].map((permission) => <span key={permission}>{permission}</span>)}
          </div>
          <div className="sku-scan-row">
            <input value={skuScan} onChange={(event) => setSkuScan(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleSkuScan(); }} placeholder="Scan or enter SKU" />
            <button className="secondary-action mini-action" type="button" onClick={handleSkuScan}><Search size={14} /> Find</button>
          </div>
          <small>{scanStatus}</small>
        </div>
        <div className="segmented-tabs">
          <button className={inventoryTab === "parts" ? "active" : ""} type="button" onClick={() => setInventoryTab("parts")}>Parts Inventory</button>
          <button className={inventoryTab === "finished" ? "active" : ""} type="button" onClick={() => setInventoryTab("finished")}>Finished Manufactured Equipment</button>
        </div>
        <div className="inventory-table-scroll">
          <table className="inventory-table tight-table">
            <thead>
              <tr><th>Image</th><th>SKU</th><th>Part</th><th>Category</th><th>Manufacturer</th><th>Stock</th><th>Unit Cost</th><th>Status</th><th></th></tr>
              <tr className="filter-row">
                <th></th>
                <th><input value={filters.ref} onChange={(event) => setFilters((current) => ({ ...current, ref: event.target.value }))} placeholder="Filter SKU" /></th>
                <th><input value={filters.part} onChange={(event) => setFilters((current) => ({ ...current, part: event.target.value }))} placeholder="Filter part" /></th>
                <th>
                  <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}>
                    <option>All</option>
                    <option>Base</option>
                    <option>Communications</option>
                    <option>Power</option>
                    <option>Lighting</option>
                    <option>Display</option>
                    <option>Build</option>
                  </select>
                </th>
                <th><input value={filters.manufacturer} onChange={(event) => setFilters((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Filter vendor" /></th>
                <th></th>
                <th></th>
                <th>
                  <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                    <option>All</option>
                    <option>Healthy</option>
                    <option>Reorder</option>
                    <option>Retired</option>
                  </select>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredInventoryItems.map((part) => {
                const pendingRequest = findPendingRequest(part);
                return (
                <tr key={part.ref} className="clickable-row" onClick={() => openEditItemModal(part)}>
                  <td onClick={(event) => event.stopPropagation()}>
                    <button className="thumbnail-button" type="button" onClick={() => setPreviewItem(part)} aria-label={`Open image for ${part.name}`}>
                      {part.imageUrl ? <img src={part.imageUrl} alt="" /> : <Image size={18} />}
                    </button>
                  </td>
                  <td><strong>{part.ref}</strong></td>
                  <td>
                    <div className="part-cell-layout">
                      <div>
                        <strong>{part.name}</strong>
                        <small>{part.description}</small>
                      </div>
                      {(part.tags ?? []).length > 0 && <div className="tag-chip-row">{(part.tags ?? []).map((tag) => <span key={tag}>{tag}</span>)}</div>}
                    </div>
                  </td>
                  <td>{part.category}</td>
                  <td>{part.manufacturer}</td>
                  <td>{part.stock}</td>
                  <td>{money(part.cost)}</td>
                  <td>{part.retired ? <span className="status retired">Retired</span> : part.stock <= part.reorderPoint ? <span className="status warn">Reorder</span> : <span className="status ok">Healthy</span>}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div className="table-actions">
                      <button
                        className={`table-action secondary-table-action${pendingRequest ? " receive-pending" : ""}`}
                        type="button"
                        onClick={() => openReceiveModal(part)}
                        disabled={part.retired}
                        title={pendingRequest ? `PO ${pendingRequest.poNumber || pendingRequest.requestNumber} is on order, not yet received` : undefined}
                      >
                        {pendingRequest ? "Receive Pending" : "Receive"}
                      </button>
                      <button className="table-action secondary-table-action" type="button" onClick={() => openAdjustModal(part)} disabled={part.retired}>Adjust</button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mobile-card-list inventory-mobile-list">
          <div className="mobile-card-filters">
            <input value={filters.ref} onChange={(event) => setFilters((current) => ({ ...current, ref: event.target.value }))} placeholder="Filter SKU" />
            <input value={filters.part} onChange={(event) => setFilters((current) => ({ ...current, part: event.target.value }))} placeholder="Filter part" />
            <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}>
              <option>All</option>
              <option>Base</option>
              <option>Communications</option>
              <option>Power</option>
              <option>Lighting</option>
              <option>Display</option>
              <option>Build</option>
            </select>
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option>All</option>
              <option>Healthy</option>
              <option>Reorder</option>
              <option>Retired</option>
            </select>
          </div>
          {filteredInventoryItems.map((part) => {
            const pendingRequest = findPendingRequest(part);
            return (
              <div key={part.ref} className="mobile-card" role="button" tabIndex={0} onClick={() => openEditItemModal(part)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openEditItemModal(part); }}>
                <span className="mobile-card-row">
                  <span
                    className="thumbnail-button"
                    role="img"
                    aria-label={`Image for ${part.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPreviewItem(part);
                    }}
                  >
                    {part.imageUrl ? <img src={part.imageUrl} alt="" /> : <Image size={18} />}
                  </span>
                  <span className="mobile-card-title">
                    <strong>{part.name}</strong>
                    <small className="muted">{part.ref} &middot; {part.category} &middot; {part.manufacturer}</small>
                  </span>
                </span>
                <span className="mobile-card-pills">
                  <span className="status">Stock: {part.stock}</span>
                  <span className="status">{money(part.cost)}</span>
                  {part.retired ? <span className="status retired">Retired</span> : part.stock <= part.reorderPoint ? <span className="status warn">Reorder</span> : <span className="status ok">Healthy</span>}
                </span>
                <span className="table-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    className={`table-action secondary-table-action${pendingRequest ? " receive-pending" : ""}`}
                    type="button"
                    onClick={() => openReceiveModal(part)}
                    disabled={part.retired}
                    title={pendingRequest ? `PO ${pendingRequest.poNumber || pendingRequest.requestNumber} is on order, not yet received` : undefined}
                  >
                    {pendingRequest ? "Receive Pending" : "Receive"}
                  </button>
                  <button className="table-action secondary-table-action" type="button" onClick={() => openAdjustModal(part)} disabled={part.retired}>Adjust</button>
                </span>
              </div>
            );
          })}
          {filteredInventoryItems.length === 0 && <div className="empty-compact-state">No items match the current filters.</div>}
        </div>
      </section>
      <section className="panel wide">
        <div className="panel-title-row">
          <div>
            <h2>Manufactured Equipment</h2>
            <p>Select equipment, edit its parts in a pop-up, then build finished units into inventory.</p>
          </div>
          <div className="action-row">
            <button className="primary-action" type="button" onClick={() => setShowDeviceModal(true)}><Plus size={15} /> Edit Equipment BOM</button>
          </div>
        </div>
        <div className="build-planner">
          <label>Equipment type<select value={buildDraft.recipeName} onChange={(event) => selectBuildRecipe(event.target.value)}>{equipmentOptions.map((recipe) => <option key={recipe.name} value={recipe.name}>{recipe.outputName}{recipe.retired ? " (Retired)" : ""}</option>)}<option value="__create_new_device">Create new equipment</option></select></label>
          <label>Quantity<input type="number" min="1" value={buildDraft.qty} onChange={(event) => setBuildDraft((current) => ({ ...current, qty: Number(event.target.value) }))} /></label>
          <div className="build-summary">
            <strong>{selectedBuildRecipe.outputName}</strong>
            <span>{selectedBuildRecipe.components.length} line items. {selectedBuildRecipe.retired ? "This equipment type is retired." : buildHasShortage ? "Some parts need purchasing before this can be built." : "All current parts are available for this quantity."}</span>
          </div>
        </div>
        {buildHasShortage && <div className="source-file"><ShoppingCart size={16} /><span>Some build parts are short. Those lines are flagged above so Procurement knows what needs to be ordered before this build can be completed.</span></div>}
        <div className="manufactured-inventory-list">
          <div className="manufactured-inventory-head">
            <span>Manufactured inventory</span>
            <span>Complete</span>
            <span>Can build</span>
          </div>
          {manufacturedEquipmentRows.map(({ recipe, finished, buildable }) => (
            <div className={recipe.retired ? "manufactured-inventory-row retired-row" : "manufactured-inventory-row"} key={recipe.name}>
              <strong>{recipe.outputName}</strong>
              <b>{finished}</b>
              <b>{recipe.retired ? "Retired" : buildable}</b>
            </div>
          ))}
        </div>
        <div className="manufacturing-actions-row">
          <button className="secondary-action" type="button" onClick={planBuild} disabled={selectedBuildRecipe.retired || buildComponentRows.length === 0}><CalendarDays size={15} /> Plan Build</button>
          <button className="secondary-action" type="button" onClick={() => setShowDeviceModal(true)} disabled={selectedBuildRecipe.retired || buildComponentRows.length === 0}>Review Build</button>
        </div>
      </section>
      <section className="panel">
        <PanelHeader title="Reorder List" label="At or below point" />
        <div className="stack">
          {lowStock.map((part) => <div className="row-card" key={part.name}><strong>{part.name}</strong><b>{part.stock}/{part.reorderPoint}</b></div>)}
        </div>
      </section>
      <section className="panel">
        <PanelHeader title="Build History" label="Undo recent manufactured equipment builds" />
        <div className="stack">
          {buildTransactions.slice(0, 6).map((build) => (
            <div className="row-card" key={build.id}>
              <div>
                <strong>{build.buildNumber}</strong>
                <span>{build.quantityBuilt} x {build.equipmentName}</span>
              </div>
              <div className="build-history-actions">
                {build.status === "planned" ? (
                  <>
                    <span className={buildReadinessForTransaction(build).hasShortage ? "status warn" : "status ok"}>{buildReadinessForTransaction(build).message}</span>
                    <button className="table-action secondary-table-action" type="button" onClick={() => setWorkOrderBuildId(build.id)}>Work Order</button>
                    {buildReadinessForTransaction(build).hasShortage && <button className="table-action secondary-table-action" type="button" onClick={() => onQueueBuildShortageRequests(build.id)}>Request Parts</button>}
                    <select value={build.stage ?? "planned"} onChange={(event) => onUpdateBuildStage(build.id, event.target.value as NonNullable<BuildTransaction["stage"]>)}>
                      <option value="planned">Planned</option>
                      <option value="kitting">Kitting</option>
                      <option value="assembled">Assembled</option>
                      <option value="tested">Tested</option>
                    </select>
                    <button className="table-action" type="button" disabled={buildReadinessForTransaction(build).hasShortage} onClick={() => {
                      const ready = buildReadinessForTransaction(build);
                      if (ready.recipe) {
                        onBuildInventoryUnit(ready.recipe, build.quantityBuilt, build.id);
                      }
                    }}>Complete</button>
                    <button className="table-action secondary-table-action" type="button" onClick={() => onCancelPlannedBuild(build.id)}>Cancel</button>
                  </>
                ) : build.status === "posted" ? (
                  <>
                    <button className="table-action secondary-table-action" type="button" onClick={() => setWorkOrderBuildId(build.id)}>Work Order</button>
                    <select value={build.stage ?? "complete"} onChange={(event) => onUpdateBuildStage(build.id, event.target.value as NonNullable<BuildTransaction["stage"]>)}>
                      <option value="planned">Planned</option>
                      <option value="kitting">Kitting</option>
                      <option value="assembled">Assembled</option>
                      <option value="tested">Tested</option>
                      <option value="complete">Complete</option>
                    </select>
                    <button className="table-action secondary-table-action" type="button" onClick={() => onUndoBuildTransaction(build.id)}>Undo</button>
                  </>
                ) : <span className="status retired">{build.status === "cancelled" ? "Cancelled" : "Undone"}</span>}
              </div>
            </div>
          ))}
          {buildTransactions.length === 0 && <div className="empty-compact-state">No build transactions yet.</div>}
        </div>
      </section>
      <section className="panel wide">
        <div className="panel-title-row">
          <div>
            <h2>Inventory Movement Ledger</h2>
            <p>Receive, transfer, build, adjust, retire, undo</p>
          </div>
          <button className="secondary-action" type="button" onClick={exportMovementLedger} disabled={inventoryMovements.length === 0}><FileText size={16} /> Export CSV</button>
        </div>
        <div className="report-table compact-report-table">
          <div className="report-table-head"><span>Type</span><span>SKU</span><span>Qty</span><span>Before / After</span><span>Reference</span></div>
          {inventoryMovements.slice(0, 10).map((movement) => (
            <div className="report-table-row" key={movement.id}>
              <span data-label="Type"><strong>{movement.type.replace("_", " ")}</strong><small>{new Date(movement.createdAt).toLocaleString()}{movement.createdByEmail ? ` -- ${movement.createdByEmail}` : ""}</small></span>
              <span data-label="SKU">{movement.sku}<small>{movement.itemName}</small></span>
              <span data-label="Qty">{movement.quantity}</span>
              <span data-label="Before / After">{movement.quantityBefore} / {movement.quantityAfter}</span>
              <span data-label="Reference">{movement.projectName ?? movement.buildNumber ?? movement.poNumber ?? movement.source}<small>{movement.notes}</small></span>
            </div>
          ))}
        </div>
      </section>
      {showDeviceModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel device-modal-panel" role="dialog" aria-modal="true" aria-labelledby="device-builder-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="device-builder-modal-title">{selectedBuildRecipe.outputName}</h2>
                <p>Manage the equipment record, BOM parts, and controlled stock consumption.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowDeviceModal(false)} aria-label="Close equipment builder">x</button>
            </div>
            <div className="device-modal-toolbar">
              <label>Equipment type<select value={buildDraft.recipeName} onChange={(event) => selectBuildRecipe(event.target.value)}>{equipmentOptions.map((recipe) => <option key={recipe.name} value={recipe.name}>{recipe.outputName}{recipe.retired ? " (Retired)" : ""}</option>)}<option value="__create_new_device">Create new equipment</option></select></label>
            </div>
            <div className="equipment-identity-card">
              <label className="equipment-image-upload">
                {selectedBuildRecipe.imageUrl ? <img src={selectedBuildRecipe.imageUrl} alt={`${selectedBuildRecipe.outputName} preview`} /> : <><Image size={24} /><span>Equipment Image</span></>}
                <input type="file" accept="image/*" onChange={(event) => uploadEquipmentImage(event.target.files?.[0])} />
              </label>
              <div className="equipment-identity-fields">
                <label>Equipment title<input value={selectedBuildRecipe.outputName} onChange={(event) => updateSelectedRecipe({ outputName: event.target.value })} /></label>
                <label>Description<textarea value={selectedBuildRecipe.description} onChange={(event) => updateSelectedRecipe({ description: event.target.value })} placeholder="Describe what this equipment build is used for..." /></label>
              </div>
            </div>
            <div className="equipment-record-actions">
              <button className="secondary-action" type="button" onClick={toggleSelectedRecipeRetired}>{selectedBuildRecipe.retired ? "Reactivate Equipment Type" : "Retire Equipment Type"}</button>
              <button className="secondary-action danger-action" type="button" onClick={deleteSelectedRecipe} disabled={deviceRecipes.length <= 1}>Delete Equipment Type</button>
            </div>
            <div className="device-line-list">
              {buildComponentRows.map((component) => (
                <div className="device-line-row" key={component.itemName}>
                  <button className="thumbnail-button" type="button" onClick={() => component.part && setPreviewItem(component.part)} aria-label={`Open image for ${component.part?.name ?? component.itemName}`}>
                    {component.part?.imageUrl ? <img src={component.part.imageUrl} alt="" /> : <Image size={16} />}
                  </button>
                  <label>Inventory item<select value={component.itemName} onChange={(event) => updateDeviceComponentItem(component.itemName, event.target.value)}>{inventoryItems.map((part) => <option key={part.ref} value={part.name}>{part.ref} - {part.name}</option>)}</select></label>
                  <label>Qty<input type="number" min="1" value={component.qty} onChange={(event) => updateDeviceComponent(component.itemName, Number(event.target.value))} /></label>
                  <div className="device-line-status">
                    <span>{component.part?.ref ?? "No SKU match"} - need {component.required}, have {component.available}</span>
                    {component.shortage > 0 ? <span className="status warn">Purchase {component.shortage}</span> : <span className="status ok">Available</span>}
                  </div>
                  <button className="icon-button compact-remove" type="button" onClick={() => removeDeviceComponent(component.itemName)} aria-label={`Remove ${component.itemName}`}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            {buildComponentRows.length === 0 && <div className="empty-compact-state">No parts added yet. Use the add line below to create the first BOM part.</div>}
            <div className="device-add-bom-row">
              <label>Add new part to BOM<select value={newComponentDraft.itemName} onChange={(event) => setNewComponentDraft((current) => ({ ...current, itemName: event.target.value }))}><option value="">Select inventory item</option>{inventoryItems.map((part) => <option key={part.ref} value={part.name}>{part.ref} - {part.name}</option>)}</select></label>
              <label>Qty<input type="number" min="1" value={newComponentDraft.qty} onChange={(event) => setNewComponentDraft((current) => ({ ...current, qty: Number(event.target.value) }))} /></label>
              <button className="secondary-action" type="button" onClick={addComponentToDevice} disabled={!newComponentDraft.itemName}><Plus size={15} /> Add new part to BOM</button>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowDeviceModal(false)}>Done</button>
              <button className="secondary-action" type="button" onClick={planBuild} disabled={selectedBuildRecipe.retired || buildComponentRows.length === 0}><CalendarDays size={15} /> Plan Build</button>
              <button className="primary-action" type="button" onClick={() => requestBuild()} disabled={selectedBuildRecipe.retired || buildHasShortage || buildComponentRows.length === 0}>Review &amp; Build Equipment</button>
            </div>
          </section>
        </div>
      )}
      {workOrderBuild && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel work-order-panel" role="dialog" aria-modal="true" aria-labelledby="work-order-title">
            <div className="modal-header">
              <div>
                <h2 id="work-order-title">{workOrderBuild.buildNumber}</h2>
                <p>{workOrderBuild.quantityBuilt} x {workOrderBuild.equipmentName} - {workOrderBuild.status}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setWorkOrderBuildId(null)} aria-label="Close work order">x</button>
            </div>
            <div className="work-order-summary">
              <div>
                <span>Equipment</span>
                <strong>{workOrderBuild.equipmentName}</strong>
              </div>
              <div>
                <span>Quantity</span>
                <strong>{workOrderBuild.quantityBuilt}</strong>
              </div>
              <label>
                Stage
                <select value={workOrderBuild.stage ?? (workOrderBuild.status === "planned" ? "planned" : "complete")} onChange={(event) => onUpdateBuildStage(workOrderBuild.id, event.target.value as NonNullable<BuildTransaction["stage"]>)}>
                  <option value="planned">Planned</option>
                  <option value="kitting">Kitting</option>
                  <option value="assembled">Assembled</option>
                  <option value="tested">Tested</option>
                  <option value="complete">Complete</option>
                </select>
              </label>
              <div>
                <span>Readiness</span>
                <strong>{!workOrderRecipe ? "Recipe missing" : workOrderHasShortage ? "Parts short" : "Ready"}</strong>
              </div>
            </div>
            {!workOrderRecipe && <div className="empty-compact-state">No equipment recipe was found for this work order.</div>}
            {workOrderRecipe && (
              <div className="work-order-lines">
                <div className="work-order-line head"><span>Part</span><span>Need</span><span>Have</span><span>Status</span></div>
                {workOrderRows.map((row) => (
                  <div className="work-order-line" key={row.component.itemName}>
                    <span><strong>{row.component.itemName}</strong><small>{row.part?.ref ?? "No SKU"} - {row.part?.manufacturer ?? "No matched inventory item"}</small></span>
                    <span>{row.required}</span>
                    <span>{row.available}</span>
                    <span>{row.shortage > 0 ? <b className="status warn">Short {row.shortage}</b> : <b className="status ok">Available</b>}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="source-file"><ClipboardList size={16} /><span>Use this as the build traveler for picking parts, kitting, assembly, and test before posting completion.</span></div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => window.print()}>Print</button>
              {workOrderBuild.status === "planned" && workOrderHasShortage && <button className="secondary-action" type="button" onClick={() => onQueueBuildShortageRequests(workOrderBuild.id)}><ShoppingCart size={15} /> Queue Shortages</button>}
              <button className="secondary-action" type="button" onClick={() => setWorkOrderBuildId(null)}>Close</button>
              {workOrderBuild.status === "planned" && workOrderRecipe && (
                <button className="primary-action" type="button" disabled={workOrderHasShortage} onClick={() => {
                  setBuildDraft({ recipeName: workOrderRecipe.name, qty: workOrderBuild.quantityBuilt });
                  setBuildConfirmAck(false);
                  setBuildConfirmPlannedId(workOrderBuild.id);
                  setShowBuildConfirm(true);
                  setWorkOrderBuildId(null);
                }}>Review Completion</button>
              )}
            </div>
          </section>
        </div>
      )}
      {showBuildConfirm && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel build-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="build-confirm-title">
            <div className="modal-header">
              <div>
                <h2 id="build-confirm-title">Confirm Equipment Build</h2>
                <p>This will consume inventory parts and add finished equipment to stock.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowBuildConfirm(false)} aria-label="Close build confirmation">x</button>
            </div>
            <div className="build-confirm-summary">
              <strong>{selectedBuildRecipe.outputName}</strong>
              <span>Quantity to build: {Math.max(1, Math.round(Number(buildDraft.qty) || 1))}</span>
            </div>
            <div className="build-confirm-audit">
              <div>
                <span>Finished stock now</span>
                <strong>{inventoryItems.find((part) => part.name === selectedBuildRecipe.outputName && part.category === "Build")?.stock ?? 0}</strong>
              </div>
              <div>
                <span>Finished stock after</span>
                <strong>{(inventoryItems.find((part) => part.name === selectedBuildRecipe.outputName && part.category === "Build")?.stock ?? 0) + Math.max(1, Math.round(Number(buildDraft.qty) || 1))}</strong>
              </div>
              <div>
                <span>Component lines</span>
                <strong>{buildComponentRows.length}</strong>
              </div>
            </div>
            <div className="build-confirm-list">
              {buildComponentRows.map((component) => (
                <div key={component.itemName}>
                  <span>{component.part?.ref ?? "No SKU"} - {component.itemName}</span>
                  <b>{component.available} to {component.available - component.required}</b>
                </div>
              ))}
            </div>
            <div className="source-file"><ShoppingCart size={16} /><span>This will post a build transaction. Use Build History to undo it if the build was entered by mistake.</span></div>
            <label className="transaction-ack">
              <input type="checkbox" checked={buildConfirmAck} onChange={(event) => setBuildConfirmAck(event.target.checked)} />
              <span>I reviewed the build quantity and understand this will consume the listed inventory parts.</span>
            </label>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowBuildConfirm(false)}>Cancel</button>
              <button className="primary-action" type="button" onClick={confirmBuild} disabled={!buildConfirmAck}>Confirm Build</button>
            </div>
          </section>
        </div>
      )}
      {previewItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel image-modal-panel" role="dialog" aria-modal="true" aria-labelledby="inventory-image-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="inventory-image-modal-title">{previewItem.name}</h2>
                <p>{previewItem.ref} - {previewItem.manufacturer}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setPreviewItem(null)} aria-label="Close image preview">x</button>
            </div>
            <div className="large-image-preview">
              {previewItem.imageUrl ? <img src={previewItem.imageUrl} alt={previewItem.name} /> : <><Image size={42} /><span>No image added yet. Use Edit to upload an image.</span></>}
            </div>
          </section>
        </div>
      )}
      {showItemModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="inventory-item-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="inventory-item-modal-title">{editingItemRef ? "Edit Inventory Item" : "Add Inventory Item"}</h2>
                <p>Manage the internal item record used by purchasing, BOMs, and transfers.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowItemModal(false)} aria-label="Close inventory item modal">x</button>
            </div>
            <div className="inventory-editor-hero">
              <label className="item-image-upload">
                {itemDraft.imageUrl ? <img src={itemDraft.imageUrl} alt={`${itemDraft.name || "Inventory item"} preview`} /> : <><Image size={28} /><span>Upload Image</span></>}
                <input type="file" accept="image/*" onChange={(event) => uploadItemImage(event.target.files?.[0])} />
              </label>
              <div className="item-identity-fields">
                <label>SKU<input value={itemDraft.ref} onChange={(event) => setItemDraft((current) => ({ ...current, ref: event.target.value }))} /></label>
                <label>Barcode / scan code<input value={itemDraft.barcode ?? ""} onChange={(event) => setItemDraft((current) => ({ ...current, barcode: event.target.value }))} placeholder="Optional scanner value" /></label>
                <label>Item name<input value={itemDraft.name} onChange={(event) => setItemDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label>Description<input value={itemDraft.description} onChange={(event) => setItemDraft((current) => ({ ...current, description: event.target.value }))} /></label>
              </div>
            </div>
            <div className="bom-modal-grid">
              <label>Category<select value={itemDraft.category} onChange={(event) => setItemDraft((current) => ({ ...current, category: event.target.value as Part["category"] }))}><option>Base</option><option>Communications</option><option>Power</option><option>Lighting</option><option>Display</option><option>Build</option></select></label>
              <label>Manufacturer<input value={itemDraft.manufacturer} onChange={(event) => setItemDraft((current) => ({ ...current, manufacturer: event.target.value }))} /></label>
              <label>Unit cost<input type="number" min="0" value={itemDraft.cost} onChange={(event) => setItemDraft((current) => ({ ...current, cost: Number(event.target.value) }))} /></label>
              <label>Current stock<input type="number" min="0" value={itemDraft.stock} onChange={(event) => setItemDraft((current) => ({ ...current, stock: Number(event.target.value) }))} /></label>
              <label>Reorder point<input type="number" min="0" value={itemDraft.reorderPoint} onChange={(event) => setItemDraft((current) => ({ ...current, reorderPoint: Number(event.target.value) }))} /></label>
            </div>
            <div className="compact-edit-section">
              <div className="compact-section-header">
                <div>
                  <h3>Inventory Tags</h3>
                  <p>Tags control where this item appears inside manufactured equipment BOMs.</p>
                </div>
              </div>
              <div className="tag-picker-grid">
                {inventoryTags.map((tag) => (
                  <label className={(itemDraft.tags ?? []).includes(tag) ? "tag-toggle selected" : "tag-toggle"} key={tag}>
                    <input type="checkbox" checked={(itemDraft.tags ?? []).includes(tag)} onChange={() => toggleItemTag(tag)} />
                    <span>{tag}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="compact-edit-section">
              <div className="compact-section-header">
                <div>
                  <h3>Purchase Sources</h3>
                  <p>Keep preferred buying links with the inventory record.</p>
                </div>
                <button className="secondary-action mini-action" type="button" onClick={addPurchaseUrl}><Plus size={14} /> Add URL</button>
              </div>
              <div className="source-url-list">
                {(itemDraft.purchaseUrls ?? []).map((source) => (
                  <div className="source-url-row" key={source.id}>
                    <input value={source.label} onChange={(event) => updatePurchaseUrl(source.id, "label", event.target.value)} placeholder="Vendor or source" />
                    <input value={source.url} onChange={(event) => updatePurchaseUrl(source.id, "url", event.target.value)} placeholder="Purchase URL" />
                    <button className="icon-button compact-remove" type="button" onClick={() => removePurchaseUrl(source.id)} aria-label="Remove purchase URL"><Trash2 size={15} /></button>
                  </div>
                ))}
                {(itemDraft.purchaseUrls ?? []).length === 0 && <div className="empty-compact-state">No purchase links yet. Add vendor URLs here.</div>}
              </div>
            </div>
            <div className="compact-edit-section">
              <div className="compact-section-header">
                <div>
                  <h3>Purchase Price History</h3>
                  <p>Track what it cost, who sold it, and why it changed.</p>
                </div>
                <button className="secondary-action mini-action" type="button" onClick={addPriceHistory}><Plus size={14} /> Add Price</button>
              </div>
              <div className="price-history-list">
                {sortedDraftHistory.map((entry) => (
                  <div className="price-history-row" key={entry.id}>
                    <input type="date" value={entry.date} onChange={(event) => updatePriceHistory(entry.id, "date", event.target.value)} aria-label="Purchase date" />
                    <input value={entry.vendor} onChange={(event) => updatePriceHistory(entry.id, "vendor", event.target.value)} placeholder="Vendor" aria-label="Vendor" />
                    <input type="number" min="0" value={entry.unitCost} onChange={(event) => updatePriceHistory(entry.id, "unitCost", Number(event.target.value))} placeholder="Unit cost" aria-label="Unit cost" />
                    <input value={entry.notes} onChange={(event) => updatePriceHistory(entry.id, "notes", event.target.value)} placeholder="Notes" aria-label="Price notes" />
                    <button className="icon-button compact-remove" type="button" onClick={() => removePriceHistory(entry.id)} aria-label="Remove price history"><Trash2 size={15} /></button>
                  </div>
                ))}
                {sortedDraftHistory.length === 0 && <div className="empty-compact-state">No price records yet. Add the first vendor cost to start tracking trend.</div>}
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowItemModal(false)}>Cancel</button>
              {editingItemRef && <button className="secondary-action danger-action" type="button" onClick={toggleItemRetired}>{itemDraft.retired ? "Reactivate Item" : "Retire Item"}</button>}
              <button className="primary-action" type="button" onClick={saveItem}>{editingItemRef ? "Save Item" : "Add Item"}</button>
            </div>
          </section>
        </div>
      )}
      {showReceiveModal && receiveItem && (() => {
        const pendingRequest = findPendingRequest(receiveItem);
        return (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="inventory-receive-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="inventory-receive-modal-title">Receive Stock</h2>
                <p>Add arrived parts to inventory and record the PO or vendor reference.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowReceiveModal(false)} aria-label="Close receive modal">x</button>
            </div>
            {pendingRequest && (
              <div className="source-file receive-pending-banner">
                <Truck size={16} />
                <span>
                  {pendingRequest.poNumber || pendingRequest.requestNumber} is on order and not yet received.{" "}
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => {
                      setShowReceiveModal(false);
                      onOpenPurchasing(pendingRequest.sku);
                    }}
                  >
                    View in Procurement
                  </button>
                </span>
              </div>
            )}
            <div className="bom-modal-grid">
              <label className="span-2">Item<select value={receiveDraft.partRef} onChange={(event) => {
                const next = inventoryItems.find((part) => part.ref === event.target.value);
                setReceiveDraft((current) => ({ ...current, partRef: event.target.value, unitCost: next?.cost ?? current.unitCost }));
              }}>{inventoryItems.filter((part) => !part.retired).map((part) => <option key={part.ref} value={part.ref}>{part.ref} - {part.name} ({part.stock} on hand)</option>)}</select></label>
              <label>Quantity received<input type="number" min="1" value={receiveDraft.qty} onChange={(event) => setReceiveDraft((current) => ({ ...current, qty: Number(event.target.value) }))} /></label>
              <label>Unit cost<input type="number" min="0" value={receiveDraft.unitCost} onChange={(event) => setReceiveDraft((current) => ({ ...current, unitCost: Number(event.target.value) }))} /></label>
              <label>PO / vendor ref<input value={receiveDraft.poNumber} onChange={(event) => setReceiveDraft((current) => ({ ...current, poNumber: event.target.value }))} placeholder="PO, receipt, or vendor" /></label>
              <label className="span-2">Notes<textarea value={receiveDraft.notes} onChange={(event) => setReceiveDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Packing slip, order note, condition, or receiving issue." /></label>
            </div>
            <div className="source-file"><Truck size={16} /><span>{receiveItem.ref} currently has {receiveItem.stock}. Receipt will leave {receiveItem.stock + Math.max(1, Math.round(Number(receiveDraft.qty) || 1))} on hand.</span></div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowReceiveModal(false)}>Cancel</button>
              <button className="primary-action" type="button" onClick={saveReceive}>Receive Stock</button>
            </div>
          </section>
        </div>
        );
      })()}
      {showAdjustModal && adjustItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="inventory-adjust-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="inventory-adjust-modal-title">Adjust Inventory</h2>
                <p>Update the stock count, or move stock out to a project.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowAdjustModal(false)} aria-label="Close adjust modal">x</button>
            </div>
            <div className="segmented-tabs">
              <button className={adjustModalMode === "count" ? "active" : ""} type="button" onClick={() => setAdjustModalMode("count")}>Adjust Count</button>
              <button className={adjustModalMode === "transfer" ? "active" : ""} type="button" onClick={() => setAdjustModalMode("transfer")}>Transfer To Project</button>
            </div>
            <div className="bom-modal-grid">
              <label className="span-2">
                Item
                {adjustLockedPart ? (
                  <input value={`${adjustItem.ref} - ${adjustItem.name} (${adjustItem.stock} on hand)`} disabled />
                ) : (
                  <select value={adjustDraft.partRef} onChange={(event) => {
                    const next = inventoryItems.find((part) => part.ref === event.target.value);
                    setAdjustDraft((current) => ({ ...current, partRef: event.target.value, nextQty: next?.stock ?? current.nextQty }));
                    setTransferDraft((current) => ({ ...current, partRef: event.target.value }));
                  }}>{inventoryItems.filter((part) => !part.retired).map((part) => <option key={part.ref} value={part.ref}>{part.ref} - {part.name} ({part.stock} on hand)</option>)}</select>
                )}
              </label>
              {adjustModalMode === "count" ? (
                <>
                  <label>New count<input type="number" min="0" value={adjustDraft.nextQty} onChange={(event) => setAdjustDraft((current) => ({ ...current, nextQty: Number(event.target.value) }))} /></label>
                  <label className="span-2">Reason / notes<textarea value={adjustDraft.notes} onChange={(event) => setAdjustDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Cycle count, damaged, missing, found, returned, or correction reason." /></label>
                </>
              ) : (
                <>
                  <label>Project<select value={transferDraft.projectName} onChange={(event) => setTransferDraft((current) => ({ ...current, projectName: event.target.value }))}>{projectSites.map((project) => <option key={project.name} value={project.name}>{project.ref} - {project.name}</option>)}</select></label>
                  <label>Quantity<input type="number" min="1" max={adjustItem.stock} value={transferDraft.qty} onChange={(event) => setTransferDraft((current) => ({ ...current, qty: Number(event.target.value) }))} /></label>
                  <label className="span-2">Notes<textarea value={transferDraft.notes} onChange={(event) => setTransferDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Install phase, location, reason, or approval note." /></label>
                </>
              )}
            </div>
            {adjustModalMode === "count" ? (
              <div className="source-file"><ClipboardList size={16} /><span>{adjustItem.ref} will move from {adjustItem.stock} to {Math.max(0, Math.round(Number(adjustDraft.nextQty) || 0))}.</span></div>
            ) : (
              <div className="source-file"><Boxes size={16} /><span>{adjustItem.stock} available. Transfer will leave {Math.max(0, adjustItem.stock - Math.max(1, Math.round(Number(transferDraft.qty) || 1)))} in inventory.</span></div>
            )}
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowAdjustModal(false)}>Cancel</button>
              {adjustModalMode === "count" ? (
                <button className="primary-action" type="button" onClick={saveAdjust}>Save Adjustment</button>
              ) : (
                <button className="primary-action" type="button" onClick={saveTransfer} disabled={adjustItem.stock <= 0}>Transfer To Project</button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// A section's "collapsed" form on the Project detail page: a small
// clickable card with a couple of quick stats, opening the real section
// in a modal on click instead of always rendering fully expanded -- the
// page was scrolling forever with everything open at once.
function ProjectTile({
  icon,
  title,
  hint,
  stats,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  stats: Array<{ label: string; value: string | number }>;
  onClick: () => void;
}) {
  return (
    <button className="project-tile" type="button" onClick={onClick}>
      <h3>{icon}{title}</h3>
      {hint && <p>{hint}</p>}
      <div className="project-tile-stats">
        {stats.map((stat) => (
          <div key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>
    </button>
  );
}

// Best-effort parse of ProjectSite.due -- it's a free-text display string
// (target_date_display), not a real date column, so values like "TBD" or
// "Q3 2026" are expected and must degrade gracefully rather than produce a
// nonsense day count.
function parseProjectDueDate(due: string): Date | null {
  if (!due.trim()) {
    return null;
  }
  const parsed = new Date(due);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ProjectPortfolioHealth({ projectSites, purchaseOrders }: { projectSites: ProjectSite[]; purchaseOrders: PurchaseOrder[] }) {
  const activeProjects = projectSites.filter((project) => project.status !== "Closed");

  const budgetRows = activeProjects
    .map((project) => {
      const spent = purchaseOrders.filter((po) => po.projectRef === project.ref).reduce((sum, po) => sum + po.total, 0);
      const pct = project.allocated > 0 ? Math.round((spent / project.allocated) * 100) : spent > 0 ? 999 : 0;
      const tone: "good" | "warn" | "critical" = pct > 100 ? "critical" : pct >= 85 ? "warn" : "good";
      return { project, spent, pct, tone };
    })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);

  const scheduleRows = activeProjects
    .map((project) => {
      const completion = projectCompletion(project);
      const dueDate = parseProjectDueDate(project.due);
      const daysLeft = dueDate ? Math.round((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
      const tone: "good" | "warn" | "critical" =
        daysLeft === null ? "good" : daysLeft < 0 && completion < 100 ? "critical" : daysLeft <= 8 && completion < 80 ? "warn" : "good";
      return { project, completion, daysLeft, tone };
    })
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity))
    .slice(0, 8);

  const totalAllocated = activeProjects.reduce((sum, project) => sum + project.allocated, 0);
  const totalSpent = budgetRows.reduce((sum, row) => sum + row.spent, 0)
    + activeProjects
        .filter((project) => !budgetRows.some((row) => row.project.ref === project.ref))
        .reduce((sum, project) => sum + purchaseOrders.filter((po) => po.projectRef === project.ref).reduce((s, po) => s + po.total, 0), 0);
  const overBudgetProjects = activeProjects.filter((project) => {
    const spent = purchaseOrders.filter((po) => po.projectRef === project.ref).reduce((sum, po) => sum + po.total, 0);
    return project.allocated > 0 && spent > project.allocated;
  });
  const behindScheduleProjects = activeProjects.filter((project) => {
    const dueDate = parseProjectDueDate(project.due);
    if (!dueDate) {
      return false;
    }
    return dueDate.getTime() < Date.now() && projectCompletion(project) < 100;
  });

  if (activeProjects.length === 0) {
    return null;
  }

  function budgetBarMetrics(pct: number) {
    const scaleMax = Math.max(pct, 100) + 15;
    return { fillWidth: Math.min(100, (pct / scaleMax) * 100), targetLeft: (100 / scaleMax) * 100 };
  }

  return (
    <section className="panel full portfolio-health">
      <div className="panel-title-row">
        <div>
          <h2>Portfolio Budget &amp; Schedule</h2>
          <p>Which active jobs are running hot on spend or slipping on the calendar, across all of them at once.</p>
        </div>
      </div>

      <div className="metric-grid portfolio-health-kpis">
        <Metric icon={<DollarSign size={20} />} label="Total Allocated" value={money(totalAllocated)} />
        <Metric icon={<DollarSign size={20} />} label="Total Spent" value={money(totalSpent)} />
        <Metric icon={<AlertTriangle size={20} />} label="Over Budget" value={String(overBudgetProjects.length)} />
        <Metric icon={<CalendarDays size={20} />} label="Behind Schedule" value={String(behindScheduleProjects.length)} />
      </div>

      <div className="portfolio-health-block">
        <div className="portfolio-health-block-head">
          <h3>Budget health</h3>
          <div className="portfolio-health-legend">
            <span className="portfolio-health-legend-item"><span className="portfolio-health-dot tone-good" />Under 85%</span>
            <span className="portfolio-health-legend-item"><span className="portfolio-health-dot tone-warn" />85&ndash;100%</span>
            <span className="portfolio-health-legend-item"><span className="portfolio-health-dot tone-critical" />Over budget</span>
          </div>
        </div>
        {budgetRows.map(({ project, spent, pct, tone }) => {
          const { fillWidth, targetLeft } = budgetBarMetrics(pct);
          return (
            <div className="portfolio-health-row" key={project.ref}>
              <div className="portfolio-health-row-name">
                <strong>{project.name}</strong>
                <small className="muted">{project.client}</small>
              </div>
              <div className="portfolio-health-bar-wrap">
                <div className="portfolio-health-figures">
                  <span>{money(spent)} spent</span>
                  <strong>{pct}%</strong>
                </div>
                <div className="portfolio-health-track">
                  <div className={`portfolio-health-fill tone-${tone}`} style={{ width: `${fillWidth}%` }}>
                    <div className="portfolio-health-tooltip">{money(spent)} of {money(project.allocated)} ({pct}%)</div>
                  </div>
                  <div className="portfolio-health-target-mark" style={{ left: `${targetLeft}%` }} />
                </div>
              </div>
              <div className="portfolio-health-status">
                <span className={`status-pill portfolio-health-pill tone-${tone}`}>{tone === "good" ? "On budget" : tone === "warn" ? "Near limit" : "Over budget"}</span>
                <small className="muted">{money(project.allocated)} allocated</small>
              </div>
            </div>
          );
        })}
      </div>

      <div className="portfolio-health-block">
        <div className="portfolio-health-block-head">
          <h3>Schedule health</h3>
          <div className="portfolio-health-legend">
            <span className="portfolio-health-legend-item"><span className="portfolio-health-dot tone-good" />On track</span>
            <span className="portfolio-health-legend-item"><span className="portfolio-health-dot tone-warn" />At risk</span>
            <span className="portfolio-health-legend-item"><span className="portfolio-health-dot tone-critical" />Behind</span>
          </div>
        </div>
        {scheduleRows.map(({ project, completion, daysLeft, tone }) => (
          <div className="portfolio-health-row" key={project.ref}>
            <div className="portfolio-health-row-name">
              <strong>{project.name}</strong>
              <small className="muted">{project.client}</small>
            </div>
            <div className="portfolio-health-bar-wrap">
              <div className="portfolio-health-figures">
                <span>Target {project.due || "Not set"}</span>
                <strong>{completion}% complete</strong>
              </div>
              <div className="portfolio-health-track">
                <div className={`portfolio-health-fill tone-${tone}`} style={{ width: `${completion}%` }}>
                  <div className="portfolio-health-tooltip">{completion}% complete{daysLeft !== null ? ` · ${daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}` : ""}</div>
                </div>
              </div>
            </div>
            <div className="portfolio-health-status">
              <span className={`status-pill portfolio-health-pill tone-${tone}`}>{tone === "good" ? "On track" : tone === "warn" ? "At risk" : "Behind"}</span>
              <small className="muted">{daysLeft === null ? "No target date" : daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Projects({
  projectSites,
  setProjectSites,
  inventoryItems,
  projectDocuments,
  onCreateDocuments,
  onUpdateDocumentStatus,
  onDownloadDocument,
  onInventoryPull,
  onQueueProjectBomPurchaseRequest,
  tasks,
  taskActivity,
  teamMembers,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onOpenTasksView,
  scheduleTemplates,
  scheduleStatus,
  onGenerateSchedule,
  submittals,
  submittalStatus,
  onLoadSubmittals,
  onCreateSubmittal,
  handoverSchema,
  handovers,
  handoverStatus,
  onLoadHandovers,
  onCreateHandover,
  onSaveHandoverResponses,
  onSubmitHandover,
  salesQuotes,
  onPullBomFromClosedQuote,
  catalogItems,
  onAddProjectLocation,
  onUpdateProjectLocation,
  onDeleteProjectLocation,
  onAddProjectLocationItem,
  onUpdateProjectLocationItem,
  onDeleteProjectLocationItem,
  onUploadProjectLocationImage,
  onDownloadProjectLocationImage,
  onDeleteProjectLocationImage,
  onGetProjectLocationImageUrl,
  onUpdateProjectLocationImageDescription,
  onUpdateProjectLocationImageMeta,
  onMoveProjectLocationImage,
  onAddProjectShippingAddress,
  onAddProjectShipment,
  onMarkProjectShipmentPacked,
  onMarkProjectShipmentShipped,
  onUploadProjectShipmentPhoto,
  onDeleteProjectShipmentPhoto,
  onGetProjectShipmentPhotoUrl,
  onDetailContextChange,
  purchaseOrders,
}: {
  projectSites: ProjectSite[];
  setProjectSites: Dispatch<SetStateAction<ProjectSite[]>>;
  inventoryItems: Part[];
  projectDocuments: UploadedDoc[];
  purchaseOrders: PurchaseOrder[];
  onCreateDocuments: (entries: Array<{ doc: Omit<UploadedDoc, "id">; file?: File }>) => void;
  onUpdateDocumentStatus: (id: UploadedDoc["id"], status: UploadedDoc["status"]) => void;
  onDownloadDocument: (doc: UploadedDoc) => void;
  onInventoryPull: (itemName: string, qty: number, projectName?: string, notes?: string) => void;
  onQueueProjectBomPurchaseRequest: (partName: string, quantity: number, projectName: string, projectRef: string, requestSpeed: BomLine["requestSpeed"], notes: string, procurementTrack: PurchaseRequest["procurementTrack"]) => Promise<boolean>;
  tasks: EOTask[];
  taskActivity: TaskActivityEntry[];
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">) => Promise<boolean>;
  onUpdateTask: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => Promise<boolean>;
  onDeleteTask: (id: string) => void;
  onOpenTasksView: () => void;
  scheduleTemplates: ScheduleTemplate[];
  scheduleStatus: string;
  onGenerateSchedule: (project: ProjectSite, templateId: string) => void;
  submittals: ProjectSubmittal[];
  submittalStatus: string;
  onLoadSubmittals: (projectName: string) => void;
  onCreateSubmittal: (project: ProjectSite, clientName: string, clientEmail: string) => void;
  handoverSchema: FormSchema | null;
  handovers: ProjectHandover[];
  handoverStatus: string;
  onLoadHandovers: (projectName: string) => void;
  onCreateHandover: (project: ProjectSite) => void;
  onSaveHandoverResponses: (handoverId: string, responses: Record<string, string>) => void;
  onSubmitHandover: (handoverId: string) => void;
  salesQuotes: SalesQuote[];
  onPullBomFromClosedQuote: (projectRef: string, quoteId: string) => number;
  catalogItems: CatalogItem[];
  onAddProjectLocation: (projectRef: string, locationType: "garage" | "lot") => void;
  onUpdateProjectLocation: (projectRef: string, locationId: string, updates: Parameters<typeof updateProjectLocation>[1]) => void;
  onDeleteProjectLocation: (projectRef: string, locationId: string) => void;
  onAddProjectLocationItem: (projectRef: string, locationId: string, lineType: ProjectLocationItem["lineType"], catalogItemId: string, qty: number, extra?: { locationLabel?: string; accessoryCatalogItemId?: string | null; accessoryQty?: number }) => void;
  onUpdateProjectLocationItem: (projectRef: string, locationId: string, itemId: string, updates: Partial<{ qty: number; locationLabel: string; accessoryCatalogItemId: string | null; accessoryQty: number }>) => void;
  onDeleteProjectLocationItem: (projectRef: string, locationId: string, itemId: string) => void;
  onUploadProjectLocationImage: (
    projectRef: string,
    locationId: string,
    imageType: "photo" | "drawing",
    file: File,
    description?: string,
    coords?: { lat: number; lng: number } | null,
  ) => Promise<boolean>;
  onDownloadProjectLocationImage: (image: ProjectLocationImage) => void;
  onDeleteProjectLocationImage: (projectRef: string, locationId: string, imageId: string, storagePath: string) => Promise<boolean>;
  onGetProjectLocationImageUrl: (image: ProjectLocationImage) => Promise<string | null>;
  onUpdateProjectLocationImageDescription: (projectRef: string, locationId: string, imageId: string, description: string) => void;
  onUpdateProjectLocationImageMeta: (projectRef: string, locationId: string, imageId: string, updates: { fileName: string; description: string }) => Promise<boolean>;
  onMoveProjectLocationImage: (projectRef: string, fromLocationId: string, imageId: string, targetLocationId: string) => Promise<boolean>;
  onAddProjectShippingAddress: (projectRef: string, address: { label: string; streetAddress: string; city: string; state: string; zip: string; attnName: string; phone: string }) => void;
  onAddProjectShipment: (projectRef: string, addressId: string | null, addressSnapshot: string, notes: string, lines: Array<{ itemName: string; qty: number }>) => void;
  onMarkProjectShipmentPacked: (projectRef: string, shipmentId: string) => void;
  onMarkProjectShipmentShipped: (projectRef: string, shipmentId: string, carrier: string, trackingNumber: string) => void;
  onUploadProjectShipmentPhoto: (projectRef: string, shipmentId: string, file: File, description?: string) => Promise<boolean>;
  onDeleteProjectShipmentPhoto: (projectRef: string, shipmentId: string, photoId: string, storagePath: string) => Promise<boolean>;
  onGetProjectShipmentPhotoUrl: (storagePath: string) => Promise<string | null>;
  onDetailContextChange?: (info: { name: string; ref: string } | null) => void;
}) {
  const initialProjectSlug = window.location.hash.startsWith("#projects/") ? window.location.hash.split("/")[1] : "";
  const initialProject = projectSites.find((project) => projectSlug(project.name) === initialProjectSlug);
  const [selectedProjectName, setSelectedProjectName] = useState(initialProject?.name ?? projects[0].name);
  const [projectMode, setProjectMode] = useState<"list" | "detail">(initialProject ? "detail" : "list");
  const [actionStatus, setActionStatus] = useState("Select a project, add a blank project, or build one from a sales quote.");
  const [galleryProjectName, setGalleryProjectName] = useState<string | null>(null);
  const galleryProject = galleryProjectName ? projectSites.find((project) => project.name === galleryProjectName) ?? null : null;
  const [isExtractingQuote, setIsExtractingQuote] = useState(false);
  const [scheduleTemplateChoice, setScheduleTemplateChoice] = useState("");
  const [submittalClientName, setSubmittalClientName] = useState("");
  const [submittalClientEmail, setSubmittalClientEmail] = useState("");
  const [copiedSubmittalId, setCopiedSubmittalId] = useState("");
  const [pullQuoteId, setPullQuoteId] = useState("");
  const [bomImportRows, setBomImportRows] = useState<Array<{ item: string; qty: number }>>([]);
  const [bomImportStatus, setBomImportStatus] = useState("");
  const [showBomModal, setShowBomModal] = useState(false);
  // Section tiles on the project detail page: each collapses to a stat
  // card and opens the real content in one of these on click, instead of
  // rendering fully expanded all the time (the page scrolled forever).
  const [showProjectInfoModal, setShowProjectInfoModal] = useState(false);
  const [showBuildSalesBomModal, setShowBuildSalesBomModal] = useState(false);
  const [showProjectDocsModal, setShowProjectDocsModal] = useState(false);
  const [showSowModal, setShowSowModal] = useState(false);
  const [showBomSectionModal, setShowBomSectionModal] = useState(false);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showLocationsModal, setShowLocationsModal] = useState(false);
  const [showSubmittalsModal, setShowSubmittalsModal] = useState(false);
  const [showHandoverModal, setShowHandoverModal] = useState(false);
  const [showSaasModal, setShowSaasModal] = useState(false);
  const [saasEditDraft, setSaasEditDraft] = useState<{ saasType: string; saasContractAmount: number | null; saasBillingFrequency: ProjectSite["saasBillingFrequency"]; saasStartDate: string; saasRenewalDate: string }>({
    saasType: "",
    saasContractAmount: null,
    saasBillingFrequency: "",
    saasStartDate: "",
    saasRenewalDate: "",
  });
  const [editingBomIndex, setEditingBomIndex] = useState<number | null>(null);
  const [bomDraft, setBomDraft] = useState({
    item: parts[0].name,
    qty: 1,
    action: "pull" as BomMaterialAction,
    requestSpeed: "Standard" as BomLine["requestSpeed"],
    notes: "",
  });
  const selectedProject = projectSites.find((project) => project.name === selectedProjectName) ?? projectSites[0];
  const selectedProjectDocuments = projectDocuments.filter((doc) => doc.project === selectedProject.name || doc.project === selectedProject.ref);

  useEffect(() => {
    onDetailContextChange?.(
      projectMode === "detail" && selectedProject ? { name: selectedProject.name, ref: selectedProject.ref } : null,
    );
    return () => onDetailContextChange?.(null);
  }, [projectMode, selectedProject?.name, selectedProject?.ref, onDetailContextChange]);

  useEffect(() => {
    onLoadSubmittals(selectedProject.name);
    onLoadHandovers(selectedProject.name);
    setSubmittalClientName(selectedProject.client);
    setSubmittalClientEmail("");
    setBomImportRows([]);
    setBomImportStatus("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject.name]);
  const bomUnits = selectedProject.bom.reduce((sum, item) => sum + item.qty, 0);
  const openBomLines = selectedProject.bom.filter((item) => item.status === "Need Quote" || item.status === "Not started").length;
  const sowHasContent = Object.values(selectedProject.sow).some((value) => value.trim() !== "");
  const shipmentStatusCounts = (selectedProject.shipments ?? []).reduce(
    (counts, shipment) => ({ ...counts, [shipment.status]: (counts[shipment.status] ?? 0) + 1 }),
    {} as Record<ProjectShipment["status"], number>,
  );
  const totalProjectValue = projectSites.reduce((sum, project) => sum + project.allocated, 0);
  const purchasingProjects = projectSites.filter((project) => project.status === "Procurement").length;
  const draftProjects = projectSites.filter((project) => project.status === "Draft" || project.status === "Planning").length;
  const bomItemSuggestions = [
    ...inventoryItems.map((part) => part.name),
    "Single Space Sensor",
    "Outdoor PoE Box",
    "UPS Unit",
    "VMS Sign",
    "Sign Controller",
    "CAT6 Cable",
    "Conduit",
    "Pole Mount",
    "Server Rack",
    "LTE Modem",
    "Solar Kit",
  ];
  const selectedInventoryItem = inventoryItems.find((part) => part.name === bomDraft.item);

  function nextProjectRef() {
    const maxRef = projectSites.reduce((currentMax, project) => {
      const match = project.ref.match(/^PRJ-2026-(\d+)$/);
      return match ? Math.max(currentMax, Number(match[1])) : currentMax;
    }, 0);

    return `PRJ-2026-${String(maxRef + 1).padStart(4, "0")}`;
  }

  useEffect(() => {
    function handleProjectRoute() {
      const hash = window.location.hash;
      if (!hash.startsWith("#projects")) {
        return;
      }

      const routeSlug = hash.split("/")[1] ?? "";
      const routeProject = projectSites.find((project) => projectSlug(project.name) === routeSlug);

      if (routeProject) {
        setSelectedProjectName(routeProject.name);
        setProjectMode("detail");
        setActionStatus(`${routeProject.name} opened.`);
        return;
      }

      setProjectMode("list");
      setActionStatus("Back to project list.");
    }

    handleProjectRoute();
    window.addEventListener("hashchange", handleProjectRoute);
    return () => window.removeEventListener("hashchange", handleProjectRoute);
  }, [projectSites]);

  function pushProjectHistory(mode: "list" | "detail", projectName?: string) {
    const slug = projectName ? projectSlug(projectName) : "";
    window.location.hash = mode === "detail" ? `projects/${slug}` : "projects";
  }

  function addDraftProject() {
    const draftName = `New Parking Site ${projectSites.length + 1}`;
    const draftProject: ProjectSite = {
      ref: nextProjectRef(),
      name: draftName,
      client: "New client",
      type: "Parking Garage",
      address: "Site address TBD",
      owner: "Project Management",
      status: "Draft",
      due: "TBD",
      package: "BOM to be built by PM",
      cameras: 0,
      allocated: 0,
      siteNotes: "Draft project record. Add garage/lot details, install requirements, and BOM lines before sending to Procurement.",
      sow: blankSow,
      bom: [
        { item: "Single Lens Camera", qty: 0, status: "Need Quote", requestSpeed: "Standard", notes: "Add expected camera count" },
        { item: "VPU / Edge Compute", qty: 0, status: "Need Quote", requestSpeed: "Standard", notes: "Add processing needs" },
        { item: "Network / PoE Hardware", qty: 0, status: "Need Quote", requestSpeed: "Standard", notes: "Add switches, enclosures, UPS, and cable needs" },
      ],
    };
    setProjectSites((current) => [draftProject, ...current]);
    setSelectedProjectName(draftName);
    setProjectMode("detail");
    pushProjectHistory("detail", draftName);
    setActionStatus(`${draftName} created. Fill in the site information, SOW, and BOM inside the project.`);
  }

  function updateSelectedProject(updater: (project: ProjectSite) => ProjectSite) {
    setProjectSites((current) => current.map((project) => (project.name === selectedProject.name ? updater(project) : project)));
  }

  function updateProjectField<K extends keyof ProjectSite>(field: K, value: ProjectSite[K]) {
    const previousName = selectedProject.name;
    updateSelectedProject((project) => ({ ...project, [field]: value }));
    if (field === "name" && typeof value === "string" && previousName === selectedProjectName) {
      setSelectedProjectName(value);
    }
  }

  // The SaaS contract's real start date is when the project actually
  // closes, not when the quote was signed -- so it's stamped here, the
  // first time status becomes "Closed," rather than being something a PM
  // types in by hand. Renewal defaults to a year out but stays editable
  // (the SaaS tile) since not every contract is a flat annual term.
  function handleProjectStatusChange(status: ProjectSite["status"]) {
    updateSelectedProject((project) => {
      if (status !== "Closed" || project.saasStartDate) {
        return { ...project, status };
      }
      const startDate = new Date().toISOString().slice(0, 10);
      const renewal = new Date();
      renewal.setFullYear(renewal.getFullYear() + 1);
      return {
        ...project,
        status,
        saasStartDate: startDate,
        saasRenewalDate: project.saasRenewalDate || renewal.toISOString().slice(0, 10),
      };
    });
  }

  function updateSowField<K extends keyof ScopeOfWork>(field: K, value: ScopeOfWork[K]) {
    updateSelectedProject((project) => ({ ...project, sow: { ...project.sow, [field]: value } }));
  }

  function openSaasModal() {
    setSaasEditDraft({
      saasType: selectedProject.saasType ?? "",
      saasContractAmount: selectedProject.saasContractAmount ?? null,
      saasBillingFrequency: selectedProject.saasBillingFrequency ?? "",
      saasStartDate: selectedProject.saasStartDate ?? "",
      saasRenewalDate: selectedProject.saasRenewalDate ?? "",
    });
    setShowSaasModal(true);
  }

  function saveSaasDraft() {
    updateSelectedProject((project) => ({ ...project, ...saasEditDraft }));
    setShowSaasModal(false);
  }

  function updateBomDraft<K extends keyof typeof bomDraft>(field: K, value: (typeof bomDraft)[K]) {
    setBomDraft((current) => ({ ...current, [field]: value }));
  }

  function openAddBomModal() {
    setEditingBomIndex(null);
    setBomDraft({ item: parts[0].name, qty: 1, action: "pull", requestSpeed: "Standard", notes: "" });
    setShowBomModal(true);
  }

  // Phase 19: spreadsheet BOM import. Parses entirely in the browser via
  // SheetJS -- no upload endpoint, no server round-trip. Preview first,
  // commit only on confirmation, straight into the same blob-backed
  // project.bom the manual "Add Material" flow already writes to.
  async function handleBomFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setBomImportStatus("Parsing...");
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed = rawRows
        .map((row) => {
          const keys = Object.keys(row);
          const findKey = (...candidates: string[]) => keys.find((key) => candidates.includes(key.trim().toLowerCase()));
          const itemKey = findKey("item", "model", "model type", "hardware", "name");
          const qtyKey = findKey("qty", "quantity");
          const item = itemKey ? String(row[itemKey]).trim() : "";
          const qty = qtyKey ? Number(row[qtyKey]) || 1 : 1;
          return { item, qty };
        })
        .filter((row) => row.item);
      setBomImportRows(parsed);
      setBomImportStatus(
        parsed.length
          ? `Parsed ${parsed.length} row(s) -- review below, then commit.`
          : "No recognizable rows found -- check column headers (Item/Model, Qty).",
      );
    } catch (error) {
      setBomImportStatus("Could not parse that file. Make sure it's a valid .xlsx or .csv.");
    }
  }

  function commitBomImport() {
    if (bomImportRows.length === 0) {
      return;
    }
    setProjectSites((current) =>
      current.map((project) =>
        project.ref === selectedProject.ref
          ? {
              ...project,
              bom: [
                ...project.bom,
                ...bomImportRows.map((row) => ({
                  item: row.item,
                  qty: row.qty,
                  status: "Not started" as BomLine["status"],
                  requestSpeed: "Standard" as BomLine["requestSpeed"],
                  notes: "Imported from spreadsheet.",
                })),
              ],
            }
          : project,
      ),
    );
    setBomImportStatus(`Added ${bomImportRows.length} line(s) to the BOM.`);
    setBomImportRows([]);
  }

  function openEditBomModal(line: BomLine, index: number) {
    setEditingBomIndex(index);
    setBomDraft({
      item: line.item,
      qty: line.qty,
      action: line.procurementTrack === "direct_to_project" ? "direct" : line.procurementTrack === "pull" ? "pull" : "order",
      requestSpeed: line.requestSpeed,
      notes: line.notes ?? "",
    });
    setShowBomModal(true);
  }

  function closeBomModal() {
    setShowBomModal(false);
    setEditingBomIndex(null);
  }

  // Procurement approval gate: adding/editing a BOM line no longer fires a
  // purchase request or inventory pull on its own -- it just records the
  // line and the fulfillment track it's meant to take. Nothing actually
  // reaches Procurement (or comes out of inventory) until the client has
  // approved a submittal for this project and someone clicks "Send to
  // Procurement" below (see handleSendBomToPurchasing).
  function addBomLine() {
    const item = bomDraft.item.trim();
    const qty = Math.max(1, Math.round(Number(bomDraft.qty) || 1));
    if (!item) {
      setActionStatus("Add a material item before saving the BOM line.");
      return;
    }

    const procurementTrack: BomLine["procurementTrack"] = bomDraft.action === "direct" ? "direct_to_project" : bomDraft.action === "pull" ? "pull" : "warehouse_stock";
    const trackNote =
      procurementTrack === "pull"
        ? `Will pull from inventory once approved.${selectedInventoryItem ? ` ${selectedInventoryItem.stock} available now.` : " Not in inventory yet."}`
        : procurementTrack === "direct_to_project"
          ? "Will be requested as a direct-to-project purchase once approved."
          : "Will be requested for Procurement to order into warehouse stock once approved.";
    const line: BomLine = {
      item,
      qty,
      status: "Not started",
      requestSpeed: bomDraft.requestSpeed,
      notes: bomDraft.notes || trackNote,
      procurementTrack,
      sentToPurchasingAt: editingBomIndex !== null ? selectedProject.bom[editingBomIndex]?.sentToPurchasingAt ?? null : null,
    };

    updateSelectedProject((project) => ({
      ...project,
      bom:
        editingBomIndex === null
          ? [...project.bom, line]
          : project.bom.map((existingLine, index) => (index === editingBomIndex ? line : existingLine)),
    }));

    setActionStatus(
      editingBomIndex !== null
        ? `${item} was updated in ${selectedProject.ref}.`
        : `${qty} ${item} added to ${selectedProject.ref} as a draft -- it won't reach Procurement until the client approves a submittal and it's sent.`,
    );

    setBomDraft({ item: parts[0].name, qty: 1, action: "pull", requestSpeed: "Standard", notes: "" });
    closeBomModal();
  }

  // Only unlocked once the project's most recent submittal has been
  // approved by the client -- this is the one place a BOM line actually
  // becomes a Purchasing request or an inventory pull.
  const latestSubmittal = submittals.length > 0 ? submittals.reduce((a, b) => (a.version > b.version ? a : b)) : null;
  const isBomApprovedForProcurement = latestSubmittal?.status === "approved";
  // Only lines still in the "Not started" draft state and never sent are
  // eligible -- this deliberately excludes lines that arrived through other
  // paths (direct inventory transfers, historical data) already carrying a
  // fulfilled/terminal status, so the bulk send can't accidentally re-process them.
  const unsentBomLines = selectedProject.bom.filter((line) => line.status === "Not started" && !line.sentToPurchasingAt);

  async function handleSendBomToPurchasing() {
    if (!isBomApprovedForProcurement) {
      setActionStatus("This project's BOM can't be sent to Procurement until the client approves a submittal.");
      return;
    }
    if (unsentBomLines.length === 0) {
      setActionStatus("Every BOM line has already been sent to Procurement.");
      return;
    }
    const sentAt = new Date().toISOString();
    const updatedLines = [...selectedProject.bom];
    let pulledCount = 0;
    let queuedCount = 0;
    let unmatchedCount = 0;
    for (let index = 0; index < updatedLines.length; index += 1) {
      const line = updatedLines[index];
      if (line.status !== "Not started" || line.sentToPurchasingAt) {
        continue;
      }
      const track = line.procurementTrack ?? "warehouse_stock";
      const inventoryPart = inventoryItems.find((part) => part.name === line.item);
      if (track === "pull" && inventoryPart && !inventoryPart.retired && inventoryPart.stock >= line.qty) {
        onInventoryPull(line.item, line.qty, selectedProject.name, line.notes || `Pulled from inventory for ${selectedProject.ref} BOM.`);
        updatedLines[index] = { ...line, status: "From Inventory", sentToPurchasingAt: sentAt };
        pulledCount += 1;
      } else {
        const resolvedTrack: PurchaseRequest["procurementTrack"] = track === "direct_to_project" ? "direct_to_project" : "warehouse_stock";
        const queued = await onQueueProjectBomPurchaseRequest(line.item, line.qty, selectedProject.name, selectedProject.ref, line.requestSpeed, line.notes ?? "", resolvedTrack);
        if (queued) {
          updatedLines[index] = { ...line, status: "Need Quote", sentToPurchasingAt: sentAt };
          queuedCount += 1;
        } else {
          unmatchedCount += 1;
        }
      }
    }
    updateSelectedProject((project) => ({ ...project, bom: updatedLines }));
    setActionStatus(
      `Sent to Procurement: ${pulledCount} pulled from inventory, ${queuedCount} purchase request(s) created` +
        (unmatchedCount > 0 ? `, ${unmatchedCount} skipped (no matching inventory SKU).` : "."),
    );
  }

  function handleSalesQuoteSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    handleSalesQuoteFile(file);
    event.target.value = "";
  }

  function handleSalesQuoteDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (isExtractingQuote) {
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleSalesQuoteFile(file);
    }
  }

  async function extractPdfText(file: File) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pageTexts.push(text);
    }

    await pdf.cleanup();
    return pageTexts.join("\n\n");
  }

  async function handleSalesQuoteFile(file: File) {
    const projectName = selectedProject.name;
    const projectRef = selectedProject.ref;

    updateProjectField("salesQuoteFile", file.name);
    onCreateDocuments([
      {
        doc: {
          name: file.name,
          project: projectName,
          size: file.size,
          status: "Ready to review",
          type: "Sales Quote",
          storage: "Browser",
          uploadedAt: new Date().toISOString(),
        },
        file,
      },
    ]);
    setIsExtractingQuote(true);
    setActionStatus(`Reading ${file.name} for ${projectRef}. Extracting PDF text in the browser...`);

    try {
      const extractedText = await extractPdfText(file);
      if (extractedText.trim().length < 100) {
        throw new Error("The PDF text was too short to map automatically.");
      }

      setActionStatus(`Mapping ${file.name} into project details, SOW, and BOM lines...`);
      const response = await fetch("/api/sales-quote-extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectRef,
          sourceFile: file.name,
          text: extractedText,
        }),
      });

      if (!response.ok) {
        throw new Error(`Extraction failed with status ${response.status}`);
      }

      const extraction = (await response.json()) as SalesQuoteExtractResponse;
      applyExtractedQuoteToProject(projectName, projectRef, extraction);
    } catch (error) {
      if (file.name.toLowerCase().includes("emerald queen")) {
        applySalesQuoteToCurrentProject(file.name);
        setActionStatus(`${projectRef} used the seeded Emerald Queen extraction because the live API was not available locally.`);
        return;
      }

      setActionStatus(`${file.name} is attached to ${projectRef}, but extraction did not finish yet. ${error instanceof Error ? error.message : "Try again after deployment."}`);
    } finally {
      setIsExtractingQuote(false);
    }
  }

  function applySalesQuoteToCurrentProject(sourceFile = emeraldQueenImportedProject.salesQuoteFile) {
    const importedProject = {
      ...emeraldQueenImportedProject,
      ref: selectedProject.ref,
      salesQuoteFile: sourceFile,
    };
    setProjectSites((current) => current.map((project) => (project.name === selectedProject.name ? importedProject : project)));
    setSelectedProjectName(importedProject.name);
    setActionStatus(`${selectedProject.ref} was filled from ${sourceFile}. Review and edit the project details, SOW, and BOM before purchasing.`);
  }

  function applyExtractedQuoteToProject(projectName: string, projectRef: string, extraction: SalesQuoteExtractResponse) {
    const importedProject = {
      ...extraction.project,
      ref: projectRef,
    };

    setProjectSites((current) => current.map((project) => (project.name === projectName ? importedProject : project)));
    setSelectedProjectName(importedProject.name);
    setActionStatus(`${projectRef} was extracted from ${importedProject.salesQuoteFile} using ${extraction.mode}. Confidence: ${extraction.confidence}. Review every field before purchasing.`);
  }

  function handleProjectDocumentSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const pickedFiles = Array.from(event.target.files ?? []);
    const files = pickedFiles.filter(isAllowedLocationDocumentFile);
    if (!files.length) {
      if (pickedFiles.length > 0) {
        setActionStatus("Project Documents only accept PDF, Word, Excel/CSV, and CAD/reference files. Put pictures in the garage/lot Photos area.");
      }
      event.target.value = "";
      return;
    }

    const entries = files.map((file, index) => ({
      doc: {
        name: file.name,
        project: selectedProject.name,
        size: file.size,
        status: "Uploaded" as const,
        type: "Project" as const,
        storage: "Browser" as const,
        uploadedAt: new Date(Date.now() + index).toISOString(),
      },
      file,
    }));
    onCreateDocuments(entries);
    setActionStatus(
      `${files.length} document${files.length === 1 ? "" : "s"} attached to ${selectedProject.ref}.` +
        (pickedFiles.length !== files.length ? " Image files were skipped; use garage/lot Photos for pictures." : ""),
    );
    event.target.value = "";
  }

  function updateProjectDocumentStatus(docId: UploadedDoc["id"], status: UploadedDoc["status"]) {
    onUpdateDocumentStatus(docId, status);
  }

  function openProject(projectName: string) {
    setSelectedProjectName(projectName);
    setProjectMode("detail");
    pushProjectHistory("detail", projectName);
    setActionStatus(`${projectName} opened.`);
  }

  function backToProjectList() {
    setProjectMode("list");
    window.location.hash = "projects";
    setActionStatus("Back to project list.");
  }

  if (projectMode === "list") {
    return (
      <div className="content-grid projects-layout">
        <section className="metric-grid">
          <Metric icon={<ClipboardList size={20} />} label="Projects" value={String(projectSites.length)} />
          <Metric icon={<DollarSign size={20} />} label="Allocated Value" value={money(totalProjectValue)} />
          <Metric icon={<ShoppingCart size={20} />} label="In Procurement" value={String(purchasingProjects)} />
          <Metric icon={<FileText size={20} />} label="Draft / Planning" value={String(draftProjects)} />
        </section>

        <TaskMiniPanel
          title="Projects Tasks"
          tasks={tasks.filter((task) => task.section === "projects" && !task.projectRef)}
          taskActivity={taskActivity}
          teamMembers={teamMembers}
          projectSites={projectSites}
          section="projects"
          isInternal
          hideAdd
          onCreate={onCreateTask}
          onUpdate={onUpdateTask}
          onDelete={onDeleteTask}
          onOpenFull={onOpenTasksView}
        />

        <ProjectPortfolioHealth projectSites={projectSites} purchaseOrders={purchaseOrders} />

        <section className="panel full">
          <div className="action-header">
            <PanelHeader title="Project List" label="Open a project to edit site info, SOW, and BOM" />
            <div className="action-row">
              <button className="primary-action" type="button" onClick={addDraftProject}><Plus size={17} /> Add New Project</button>
            </div>
          </div>
          <div className="projects-table-scroll">
          <table>
            <thead>
              <tr><th>Ref</th><th>Project</th><th>Client</th><th>Status</th><th>Completion</th><th>Open BOM</th><th>Target</th><th>Allocated</th><th></th></tr>
            </thead>
            <tbody>
              {projectSites.map((project) => {
                const completion = projectCompletion(project);
                const openLines = project.bom.filter((line) => line.status === "Need Quote" || line.status === "Not started").length;
                return (
                  <tr key={project.name} className="clickable-row" onClick={() => openProject(project.name)}>
                    <td><strong>{project.ref}</strong></td>
                    <td><strong>{project.name}</strong><small>{project.type} - {project.package}</small></td>
                    <td>{project.client}</td>
                    <td><span className={`status ${project.status === "Procurement" ? "warn" : project.status === "Install Ready" || project.status === "Closed" ? "ok" : ""}`}>{project.status}</span></td>
                    <td>
                      <div className="progress-cell"><span>{completion}%</span><i><b style={{ width: `${completion}%` }} /></i></div>
                    </td>
                    <td>{openLines}</td>
                    <td>{project.due}</td>
                    <td>{money(project.allocated)}</td>
                    <td>
                      <button
                        className="table-action"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setGalleryProjectName(project.name);
                        }}
                      >
                        Images
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          <div className="mobile-card-list">
            {projectSites.map((project) => {
              const completion = projectCompletion(project);
              const openLines = project.bom.filter((line) => line.status === "Need Quote" || line.status === "Not started").length;
              return (
                <div key={project.name} className="mobile-card" role="button" tabIndex={0} onClick={() => openProject(project.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openProject(project.name); }}>
                  <span className="mobile-card-row">
                    <span className="mobile-card-title">
                      <strong>{project.name}</strong>
                      <small className="muted">{project.ref} &middot; {project.client}</small>
                    </span>
                    <span className={`status ${project.status === "Procurement" ? "warn" : project.status === "Install Ready" || project.status === "Closed" ? "ok" : ""}`}>{project.status}</span>
                  </span>
                  <span className="mobile-card-meta">{project.type} &middot; {openLines} open BOM &middot; Target {project.due} &middot; {money(project.allocated)} allocated</span>
                  <span className="mobile-card-pills">
                    <div className="progress-cell"><span>{completion}% complete</span><i><b style={{ width: `${completion}%` }} /></i></div>
                  </span>
                  <span onClick={(event) => event.stopPropagation()}>
                    <button className="secondary-action mini-action" type="button" onClick={() => setGalleryProjectName(project.name)}>Images</button>
                  </span>
                </div>
              );
            })}
            {projectSites.length === 0 && <div className="empty-compact-state">No projects yet.</div>}
          </div>
        </section>

        {galleryProject && (
          <SiteGalleryModal
            siteName={galleryProject.name}
            locations={galleryProject.locations ?? []}
            onGetUrl={onGetProjectLocationImageUrl}
            onUpdate={(locationId, image, updates) => onUpdateProjectLocationImageMeta(galleryProject.ref, locationId, image.id, updates)}
            onMove={(locationId, image, targetLocationId) => onMoveProjectLocationImage(galleryProject.ref, locationId, image.id, targetLocationId)}
            onDelete={(locationId, image) => onDeleteProjectLocationImage(galleryProject.ref, locationId, image.id, image.storagePath)}
            onClose={() => setGalleryProjectName(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="content-grid projects-layout">
      <div className="project-detail-header">
        <div className="project-detail-breadcrumb">
          <span>Projects</span> / <strong>{selectedProject.name}</strong>
        </div>
        <div className="project-detail-header-actions">
          <div className="locked-ref-inline"><span>Ref</span><strong>{selectedProject.ref}</strong></div>
          <button className="secondary-action mini-action" type="button" onClick={backToProjectList}>Back to Projects</button>
        </div>
      </div>

      <div className="project-top-row">
        <section className="panel compact-card clickable-card" onClick={() => setShowProjectInfoModal(true)}>
          <PanelHeader title="Project Information" label="Client, location, and install context" onEdit={() => setShowProjectInfoModal(true)} />
          <div className="site-info-list">
            <div><Building2 size={17} /><span>Client</span><strong>{selectedProject.client}</strong></div>
            <div><MapPin size={17} /><span>Client Address</span><strong>{selectedProject.address}</strong></div>
            <div><User size={17} /><span>Owner</span><strong>{selectedProject.owner}</strong></div>
            <div><CalendarDays size={17} /><span>Target</span><strong>{selectedProject.due}</strong></div>
          </div>
        </section>

        <section className="panel compact-card">
          <PanelHeader title="Project Snapshot" label="PM request summary" />
          <div className="snapshot-grid">
            <div><span>Cameras</span><strong>{selectedProject.cameras}</strong></div>
            <div><span>BOM Units</span><strong>{bomUnits}</strong></div>
            <div><span>Open BOM Lines</span><strong>{openBomLines}</strong></div>
            <div><span>Allocated</span><strong>{money(selectedProject.allocated)}</strong></div>
          </div>
        </section>

        <section className="panel compact-card project-progress-card">
          <PanelHeader title="Project Progress" label="Completion and key points" />
          <div className="project-progress-body">
            <div className="progress-ring" style={{ "--pct": projectCompletion(selectedProject) } as React.CSSProperties}>
              <span>{projectCompletion(selectedProject)}%</span>
            </div>
            <div className="progress-points">
              <div><span>Status</span><strong className={`status ${selectedProject.status === "Procurement" ? "warn" : selectedProject.status === "Install Ready" || selectedProject.status === "Closed" ? "ok" : ""}`}>{selectedProject.status}</strong></div>
              <div><span>Target</span><strong>{selectedProject.due}</strong></div>
              <div><span>Allocated</span><strong>{money(selectedProject.allocated)}</strong></div>
              <div><span>Open BOM</span><strong>{openBomLines}</strong></div>
            </div>
          </div>
          <div className="schedule-generate-row">
            <select value={scheduleTemplateChoice} onChange={(event) => setScheduleTemplateChoice(event.target.value)}>
              <option value="">Apply schedule template...</option>
              {scheduleTemplates.filter((template) => template.isActive).map((template) => (
                <option key={template.id} value={template.id}>{template.name} ({template.phases.length} phases)</option>
              ))}
            </select>
            <button
              className="secondary-action mini-action"
              type="button"
              disabled={!scheduleTemplateChoice}
              onClick={() => scheduleTemplateChoice && onGenerateSchedule(selectedProject, scheduleTemplateChoice)}
            >
              Generate Schedule
            </button>
          </div>
          {scheduleStatus && <small className="muted">{scheduleStatus}</small>}
        </section>
      </div>


      {showBuildSalesBomModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-tile-close-row">
              <button className="icon-button" type="button" onClick={() => setShowBuildSalesBomModal(false)} aria-label="Close">x</button>
            </div>
            <section className="panel compact-card">
              <PanelHeader title="Build Sales BOM and Scope" label="One-time setup: upload a sales quote PDF" />
              <label className={`sales-dropzone compact-row ${isExtractingQuote ? "is-working" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleSalesQuoteDrop}>
                <Upload size={15} />
                <strong>{isExtractingQuote ? "Reading sales quote..." : "Drag or choose sales quote PDF"}</strong>
                <input type="file" accept=".pdf" onChange={handleSalesQuoteSelect} disabled={isExtractingQuote} />
              </label>
              {selectedProject.salesQuoteFile && <div className="source-file"><FileText size={16} /><span>{selectedProject.salesQuoteFile}</span></div>}

              <div className="quote-pull-row">
                <select value={pullQuoteId} onChange={(event) => setPullQuoteId(event.target.value)}>
                  <option value="">Or pull from a Closed - Won sales quote...</option>
                  {salesQuotes.filter((quote) => quote.status === "closed_won").map((quote) => (
                    <option key={quote.id} value={quote.id}>{quote.siteName} ({quote.clientName})</option>
                  ))}
                </select>
                <button
                  className="secondary-action mini-action"
                  type="button"
                  disabled={!pullQuoteId}
                  onClick={() => {
                    const count = onPullBomFromClosedQuote(selectedProject.ref, pullQuoteId);
                    setActionStatus(count > 0 ? `Pulled ${count} BOM line${count === 1 ? "" : "s"} from the sales quote.` : "That quote has no BOM lines to pull, or it could not be found.");
                    setPullQuoteId("");
                  }}
                >
                  Pull BOM from Closed Sales
                </button>
                {salesQuotes.filter((quote) => quote.status === "closed_won").length === 0 && (
                  <small className="muted">No Closed - Won quotes yet -- mark one Closed - Won in Sales -&gt; Site Builder to pull from it here.</small>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {showProjectDocsModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-tile-close-row">
              <button className="icon-button" type="button" onClick={() => setShowProjectDocsModal(false)} aria-label="Close">x</button>
            </div>
            <section className="panel compact-card">
              <div className="panel-title-row">
                <div>
                  <h2>Project Documents</h2>
                  <p>Backups and reference files.</p>
                </div>
                <label className="secondary-action mini-action project-doc-upload">
                  <Upload size={15} /> Upload
                  <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.dwg,.dxf,.rvt,.ifc,.step,.stp" multiple onChange={handleProjectDocumentSelect} />
                </label>
              </div>
              <div className="upload-rule-note">
                <FileText size={15} />
                <span>Project Documents are for PDF, Word, Excel/CSV, and CAD/reference files. Garage/lot pictures belong in Photos.</span>
              </div>
              <div className="project-doc-list">
                {selectedProjectDocuments.map((doc) => (
                  <div className="document-row" key={`${doc.id}-${doc.name}`}>
                    <div>
                      <strong>{doc.name}</strong>
                      <span>{doc.type ?? "Project"} - {doc.size ? formatBytes(doc.size) : "linked sample"} - {doc.storage ?? "Browser"}</span>
                      <small>{formatDocumentProvenance(doc)}</small>
                    </div>
                    <select value={doc.status} onChange={(event) => updateProjectDocumentStatus(doc.id, event.target.value as UploadedDoc["status"])}>
                      <option>Uploaded</option>
                      <option>Ready to review</option>
                      <option>Backed up</option>
                      <option>Archived</option>
                    </select>
                    {doc.storagePath && (
                      <button className="secondary-action mini-action" type="button" onClick={() => onDownloadDocument(doc)}>Download</button>
                    )}
                  </div>
                ))}
                {selectedProjectDocuments.length === 0 && <div className="empty-compact-state">No documents yet.</div>}
              </div>
            </section>
          </div>
        </div>
      )}

      <TaskMiniPanel
        title="Project Tasks"
        tasks={tasks.filter((task) => task.projectRef === selectedProject.ref)}
        taskActivity={taskActivity}
        teamMembers={teamMembers}
        projectSites={projectSites}
        section="projects"
        projectRef={selectedProject.ref}
        isInternal={false}
        onCreate={onCreateTask}
        onUpdate={onUpdateTask}
        onDelete={onDeleteTask}
        onOpenFull={onOpenTasksView}
      />

      {showLocationsModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-tile-close-row">
              <button className="icon-button" type="button" onClick={() => setShowLocationsModal(false)} aria-label="Close">x</button>
            </div>
            <ProjectLocationsSection
              project={selectedProject}
              catalogItems={catalogItems}
              onAddLocation={(locationType) => onAddProjectLocation(selectedProject.ref, locationType)}
              onUpdateLocation={(locationId, updates) => onUpdateProjectLocation(selectedProject.ref, locationId, updates)}
              onDeleteLocation={(locationId) => onDeleteProjectLocation(selectedProject.ref, locationId)}
              onAddLocationItem={(locationId, lineType, catalogItemId, qty, extra) => onAddProjectLocationItem(selectedProject.ref, locationId, lineType, catalogItemId, qty, extra)}
              onUpdateLocationItem={(locationId, itemId, updates) => onUpdateProjectLocationItem(selectedProject.ref, locationId, itemId, updates)}
              onDeleteLocationItem={(locationId, itemId) => onDeleteProjectLocationItem(selectedProject.ref, locationId, itemId)}
              onUploadImage={(locationId, imageType, file, description, coords) => onUploadProjectLocationImage(selectedProject.ref, locationId, imageType, file, description, coords)}
              onDownloadImage={onDownloadProjectLocationImage}
              onDeleteImage={(locationId, imageId, storagePath) => onDeleteProjectLocationImage(selectedProject.ref, locationId, imageId, storagePath)}
              onGetImageUrl={onGetProjectLocationImageUrl}
              onUpdateImageDescription={(locationId, imageId, description) => onUpdateProjectLocationImageDescription(selectedProject.ref, locationId, imageId, description)}
              onUpdateImageMeta={(locationId, imageId, updates) => onUpdateProjectLocationImageMeta(selectedProject.ref, locationId, imageId, updates)}
              onMoveImage={(locationId, imageId, targetLocationId) => onMoveProjectLocationImage(selectedProject.ref, locationId, imageId, targetLocationId)}
            />
          </div>
        </div>
      )}

      {showSubmittalsModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-tile-close-row">
              <button className="icon-button" type="button" onClick={() => setShowSubmittalsModal(false)} aria-label="Close">x</button>
            </div>
            <section className="panel full submittals-panel">
              <div className="panel-title-row">
                <div>
                  <h2>Submittals</h2>
                  <p>Client sign-off on scope and BOM before final purchasing.</p>
                </div>
              </div>
              <div className="submittal-create-row">
                <input
                  placeholder="Client name"
                  value={submittalClientName}
                  onChange={(event) => setSubmittalClientName(event.target.value)}
                />
                <input
                  placeholder="Client email (optional)"
                  value={submittalClientEmail}
                  onChange={(event) => setSubmittalClientEmail(event.target.value)}
                />
                <button
                  className="primary-action mini-action"
                  type="button"
                  onClick={() => onCreateSubmittal(selectedProject, submittalClientName, submittalClientEmail)}
                >
                  Create &amp; Send Submittal
                </button>
              </div>
              {submittalStatus && <small className="muted">{submittalStatus}</small>}
              <div className="submittal-list">
                {submittals.length === 0 && <div className="empty-compact-state">No submittals yet for this project.</div>}
                {submittals.map((submittal) => (
                  <div className="submittal-row" key={submittal.id}>
                    <div className="submittal-row-head">
                      <strong>Version {submittal.version}</strong>
                      <span className={`status-pill submittal-status-${submittal.status}`}>{submittal.status.replace(/_/g, " ")}</span>
                    </div>
                    <div className="submittal-meta">
                      <span>Sent {submittal.sentAt ? new Date(submittal.sentAt).toLocaleDateString() : "-"}</span>
                      {submittal.respondedAt && (
                        <span>Responded {new Date(submittal.respondedAt).toLocaleDateString()} by {submittal.approvalName || "client"}</span>
                      )}
                    </div>
                    {submittal.responseNotes && <p className="submittal-notes">"{submittal.responseNotes}"</p>}
                    {submittal.shareToken && (
                      <button
                        className={`secondary-action mini-action ${copiedSubmittalId === submittal.id ? "just-copied" : ""}`}
                        type="button"
                        onClick={() => {
                          const link = `${window.location.origin}${window.location.pathname}?submittal=${submittal.shareToken}`;
                          navigator.clipboard?.writeText(link).then(() => {
                            setCopiedSubmittalId(submittal.id);
                            setTimeout(() => setCopiedSubmittalId(""), 2000);
                          });
                        }}
                      >
                        {copiedSubmittalId === submittal.id ? "Copied!" : "Copy client link"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {showHandoverModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-tile-close-row">
              <button className="icon-button" type="button" onClick={() => setShowHandoverModal(false)} aria-label="Close">x</button>
            </div>
            <section className="panel full handover-panel">
              <div className="panel-title-row">
                <div>
                  <h2>After-Sales Handover</h2>
                  <p>Site requirements captured at sales-to-operations handoff.</p>
                </div>
                <button className="primary-action mini-action" type="button" onClick={() => onCreateHandover(selectedProject)}>
                  <Plus size={14} /> New Handover
                </button>
              </div>
              {handoverStatus && <small className="muted">{handoverStatus}</small>}
              {handovers.length === 0 && <div className="empty-compact-state">No handovers yet for this project.</div>}
              {handovers.map((handover) => (
                <div className="handover-block" key={handover.id}>
                  <div className="submittal-row-head">
                    <span className={`status-pill submittal-status-${handover.status === "submitted" ? "approved" : "draft"}`}>{handover.status}</span>
                    {handover.submittedAt && <span className="muted">Submitted {new Date(handover.submittedAt).toLocaleDateString()} by {handover.submittedByEmail}</span>}
                  </div>
                  {handoverSchema && (
                    <div className="form-grid">
                      {[...handoverSchema.fields].sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((field) => (
                        <label key={field.id} className={field.fieldType === "textarea" ? "span-2" : undefined}>
                          <span>{field.label}{field.isRequired ? " *" : ""}</span>
                          {field.fieldType === "select" ? (
                            <select
                              value={handover.responses[field.fieldKey] ?? ""}
                              disabled={handover.status === "submitted"}
                              onChange={(event) => onSaveHandoverResponses(handover.id, { ...handover.responses, [field.fieldKey]: event.target.value })}
                            >
                              <option value="">Select...</option>
                              {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          ) : field.fieldType === "textarea" ? (
                            <textarea
                              value={handover.responses[field.fieldKey] ?? ""}
                              disabled={handover.status === "submitted"}
                              placeholder={field.placeholder}
                              onChange={(event) => onSaveHandoverResponses(handover.id, { ...handover.responses, [field.fieldKey]: event.target.value })}
                            />
                          ) : field.fieldType === "checkbox" ? (
                            <input
                              type="checkbox"
                              checked={handover.responses[field.fieldKey] === "true"}
                              disabled={handover.status === "submitted"}
                              onChange={(event) => onSaveHandoverResponses(handover.id, { ...handover.responses, [field.fieldKey]: event.target.checked ? "true" : "false" })}
                            />
                          ) : (
                            <input
                              type={field.fieldType === "date" ? "date" : field.fieldType === "number" ? "number" : "text"}
                              value={handover.responses[field.fieldKey] ?? ""}
                              disabled={handover.status === "submitted"}
                              placeholder={field.placeholder}
                              onChange={(event) => onSaveHandoverResponses(handover.id, { ...handover.responses, [field.fieldKey]: event.target.value })}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                  {handover.status === "draft" && (
                    <button className="secondary-action mini-action" type="button" onClick={() => onSubmitHandover(handover.id)}>Submit Handover</button>
                  )}
                </div>
              ))}
            </section>
          </div>
        </div>
      )}

      {showProjectInfoModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-tile-close-row">
              <button className="icon-button" type="button" onClick={() => setShowProjectInfoModal(false)} aria-label="Close">x</button>
            </div>
            <section className="panel full">
              <div className="panel-title-row">
                <div>
                  <h2>Project Information</h2>
                  <p>Editable site intake for this parking garage or lot</p>
                </div>
              </div>
              <div className="form-grid">
                <label>Project name<input value={selectedProject.name} onChange={(event) => updateProjectField("name", event.target.value)} /></label>
                <label>Client / property<input value={selectedProject.client} onChange={(event) => updateProjectField("client", event.target.value)} /></label>
                <label>Site type<select value={selectedProject.type} onChange={(event) => updateProjectField("type", event.target.value as ProjectSite["type"])}><option>Parking Garage</option><option>Surface Lot</option><option>Campus Parking</option><option>Mixed Parking</option></select></label>
                <label>Project owner<input value={selectedProject.owner} onChange={(event) => updateProjectField("owner", event.target.value)} /></label>
                <label className="span-2">Client address<input value={selectedProject.address} onChange={(event) => updateProjectField("address", event.target.value)} /></label>
                <label>Status<select value={selectedProject.status} onChange={(event) => handleProjectStatusChange(event.target.value as ProjectSite["status"])}><option>Draft</option><option>Planning</option><option>Procurement</option><option>Staging</option><option>Install Ready</option><option>Closed</option></select></label>
                <label>Target date<input value={selectedProject.due} onChange={(event) => updateProjectField("due", event.target.value)} /></label>
                <label className="span-2">Solution / package<input value={selectedProject.package} onChange={(event) => updateProjectField("package", event.target.value)} /></label>
                <label className="span-2">Site notes<textarea value={selectedProject.siteNotes} onChange={(event) => updateProjectField("siteNotes", event.target.value)} /></label>
              </div>
            </section>
          </div>
        </div>
      )}

      <div className="project-tile-grid">
        <ProjectTile
          icon={<Upload size={18} />}
          title="Build Sales BOM"
          hint="One-time setup: upload a sales quote PDF"
          stats={[
            { label: "Source", value: selectedProject.salesQuoteFile ? "Uploaded" : "Not set" },
            { label: "BOM lines", value: selectedProject.bom.length },
          ]}
          onClick={() => setShowBuildSalesBomModal(true)}
        />
        <ProjectTile
          icon={<FileText size={18} />}
          title="Project Documents"
          hint="Backups and reference files"
          stats={[{ label: "Files", value: selectedProjectDocuments.length }]}
          onClick={() => setShowProjectDocsModal(true)}
        />
        <ProjectTile
          icon={<ListChecks size={18} />}
          title="SOW - Scope of Work"
          hint="Generated from sales quote, editable"
          stats={[{ label: "Status", value: sowHasContent ? "Drafted" : "Empty" }]}
          onClick={() => setShowSowModal(true)}
        />
        <ProjectTile
          icon={<Boxes size={18} />}
          title="BOM - Bill of Material"
          hint="Material lines and Procurement"
          stats={[
            { label: "Items", value: selectedProject.bom.length },
            { label: "Open", value: openBomLines },
          ]}
          onClick={() => setShowBomSectionModal(true)}
        />
        <ProjectTile
          icon={<Truck size={18} />}
          title="Shipping"
          hint="Request and fulfill shipments"
          stats={[
            { label: "Requested", value: shipmentStatusCounts.Requested ?? 0 },
            { label: "Packed", value: shipmentStatusCounts.Packed ?? 0 },
            { label: "Shipped", value: shipmentStatusCounts.Shipped ?? 0 },
            { label: "BOM items", value: selectedProject.bom.length },
          ]}
          onClick={() => setShowShippingModal(true)}
        />
        <ProjectTile
          icon={<MapPin size={18} />}
          title="Locations"
          hint="Garage/lot breakdown"
          stats={[{ label: "Garages/Lots", value: (selectedProject.locations ?? []).length }]}
          onClick={() => setShowLocationsModal(true)}
        />
        <ProjectTile
          icon={<FileText size={18} />}
          title="Submittals"
          hint="Client sign-off on scope + BOM"
          stats={[
            { label: "Created", value: submittals.length },
            { label: "Latest", value: latestSubmittal ? latestSubmittal.status.replace(/_/g, " ") : "None" },
          ]}
          onClick={() => setShowSubmittalsModal(true)}
        />
        <ProjectTile
          icon={<ListChecks size={18} />}
          title="After-Sales Handover"
          hint="Site requirements at handoff"
          stats={[
            { label: "Handovers", value: handovers.length },
            { label: "Latest", value: handovers[0]?.status ?? "None" },
          ]}
          onClick={() => setShowHandoverModal(true)}
        />
        <ProjectTile
          icon={<CalendarDays size={18} />}
          title="SaaS"
          hint="Contract start, type, and renewal"
          stats={[
            { label: "Start date", value: selectedProject.saasStartDate || "Not set" },
            { label: "SaaS type", value: selectedProject.saasType || "Not set" },
            { label: "Renewal date", value: selectedProject.saasRenewalDate || "Not set" },
            { label: "Contract", value: selectedProject.saasContractAmount ? money(selectedProject.saasContractAmount) : "Not set" },
          ]}
          onClick={openSaasModal}
        />
      </div>

      {showSaasModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="saas-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="saas-modal-title">SaaS Contract</h2>
                <p>Start date is stamped automatically when the project's status is set to Closed. Everything else here is editable any time.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowSaasModal(false)} aria-label="Close">x</button>
            </div>
            <div className="bom-modal-grid">
              <label>Start date<input type="date" value={saasEditDraft.saasStartDate} onChange={(event) => setSaasEditDraft((current) => ({ ...current, saasStartDate: event.target.value }))} /></label>
              <label>Renewal date<input type="date" value={saasEditDraft.saasRenewalDate} onChange={(event) => setSaasEditDraft((current) => ({ ...current, saasRenewalDate: event.target.value }))} /></label>
              <label className="span-2">SaaS type<input value={saasEditDraft.saasType} onChange={(event) => setSaasEditDraft((current) => ({ ...current, saasType: event.target.value }))} placeholder="e.g. Cloud Monitoring, Analytics" /></label>
              <label>
                Contract amount
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={saasEditDraft.saasContractAmount ?? ""}
                  onChange={(event) => setSaasEditDraft((current) => ({ ...current, saasContractAmount: event.target.value === "" ? null : Number(event.target.value) }))}
                  placeholder="0.00"
                />
              </label>
              <label>
                Billing frequency
                <select value={saasEditDraft.saasBillingFrequency} onChange={(event) => setSaasEditDraft((current) => ({ ...current, saasBillingFrequency: event.target.value as ProjectSite["saasBillingFrequency"] }))}>
                  <option value="">Select...</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Annual">Annual</option>
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowSaasModal(false)}>Cancel</button>
              <button className="primary-action" type="button" onClick={saveSaasDraft}>Save</button>
            </div>
          </section>
        </div>
      )}

      {showSowModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-tile-close-row">
              <button className="icon-button" type="button" onClick={() => setShowSowModal(false)} aria-label="Close">x</button>
            </div>
            <section className="panel full">
              <PanelHeader title="SOW - Scope of Work" label="Generated from sales quote and editable by the team" />
              <div className="sow-grid">
                <label className="span-2">Summary<textarea value={selectedProject.sow.summary} onChange={(event) => updateSowField("summary", event.target.value)} /></label>
                <label>Preparation<textarea value={selectedProject.sow.preparation} onChange={(event) => updateSowField("preparation", event.target.value)} /></label>
                <label>Infrastructure<textarea value={selectedProject.sow.infrastructure} onChange={(event) => updateSowField("infrastructure", event.target.value)} /></label>
                <label>Installation<textarea value={selectedProject.sow.installation} onChange={(event) => updateSowField("installation", event.target.value)} /></label>
                <label>Commissioning<textarea value={selectedProject.sow.commissioning} onChange={(event) => updateSowField("commissioning", event.target.value)} /></label>
                <label>Fine tuning / go-live<textarea value={selectedProject.sow.fineTuning} onChange={(event) => updateSowField("fineTuning", event.target.value)} /></label>
                <label>Assumptions<textarea value={selectedProject.sow.assumptions} onChange={(event) => updateSowField("assumptions", event.target.value)} /></label>
                <label className="span-2">Exclusions<textarea value={selectedProject.sow.exclusions} onChange={(event) => updateSowField("exclusions", event.target.value)} /></label>
              </div>
            </section>
          </div>
        </div>
      )}

      {showBomSectionModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-tile-close-row">
              <button className="icon-button" type="button" onClick={() => setShowBomSectionModal(false)} aria-label="Close">x</button>
            </div>
            <section className="panel full">
              <div className="panel-title-row">
                <div>
                  <h2>BOM - Bill of Material</h2>
                  <p>Add and edit material lines here -- they stay drafts until a submittal for this project is client-approved, then send them to Procurement below.</p>
                </div>
                <div className="report-filter-row">
                  <label className="secondary-action mini-action project-doc-upload">
                    <Upload size={15} /> Import Spreadsheet
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={handleBomFileSelect} />
                  </label>
                  <button className="primary-action" type="button" onClick={openAddBomModal}><Plus size={17} /> Add Material</button>
                </div>
              </div>
              <div className="report-filter-row">
                {isBomApprovedForProcurement ? (
                  <button className="primary-action mini-action" type="button" onClick={handleSendBomToPurchasing} disabled={unsentBomLines.length === 0}>
                    <Truck size={14} /> Send {unsentBomLines.length > 0 ? `${unsentBomLines.length} Line(s) ` : ""}to Procurement
                  </button>
                ) : (
                  <span className="muted">
                    {latestSubmittal ? `Waiting on client approval (submittal is currently "${latestSubmittal.status}") before this BOM can be sent to Procurement.` : "Create and send a submittal below for client approval before this BOM can be sent to Procurement."}
                  </span>
                )}
              </div>
              {bomImportStatus && <small className="muted">{bomImportStatus}</small>}
              {bomImportRows.length > 0 && (
                <div className="bom-import-preview">
                  <table className="stack-table-mobile">
                    <thead><tr><th>Item</th><th>Qty</th></tr></thead>
                    <tbody>
                      {bomImportRows.map((row, index) => <tr key={index}><td data-label="Item">{row.item}</td><td data-label="Qty">{row.qty}</td></tr>)}
                    </tbody>
                  </table>
                  <div className="report-filter-row">
                    <button className="primary-action mini-action" type="button" onClick={commitBomImport}>Commit {bomImportRows.length} Line(s) to BOM</button>
                    <button className="secondary-action mini-action" type="button" onClick={() => { setBomImportRows([]); setBomImportStatus(""); }}>Discard</button>
                  </div>
                </div>
              )}
              <table className="stack-table-mobile">
                <thead>
                  <tr><th>Hardware</th><th>Qty</th><th>Status</th><th>Request Speed</th><th>PO</th><th>Notes</th><th></th></tr>
                </thead>
                <tbody>
                  {selectedProject.bom.map((line, index) => (
                    <tr key={`${selectedProject.name}-${line.item}-${index}`}>
                      <td><strong>{line.item}</strong></td>
                      <td data-label="Qty">{line.qty}</td>
                      <td data-label="Status"><span className={`status ${line.status === "Need Quote" || line.status === "Not started" ? "warn" : line.status.includes("Delivered") || line.status === "Completed" || line.status === "From Inventory" ? "ok" : ""}`}>{line.status}</span>{!line.sentToPurchasingAt && <small className="muted"> (draft)</small>}</td>
                      <td data-label="Request Speed">{line.requestSpeed}</td>
                      <td data-label="PO">{line.po ?? "TBD"}</td>
                      <td data-label="Notes">{line.notes ?? "Ready for PM details"}</td>
                      <td><button className="table-action secondary-table-action" type="button" onClick={() => openEditBomModal(line, index)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      )}

      {showBomModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="bom-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="bom-modal-title">{editingBomIndex === null ? "Add BOM Material" : "Edit BOM Material"}</h2>
                <p>This is saved as a draft -- it won't pull from inventory or reach Procurement until the client approves a submittal and the BOM is sent.</p>
              </div>
              <button className="icon-button" type="button" onClick={closeBomModal} aria-label="Close BOM modal">x</button>
            </div>

            <div className="bom-modal-grid">
              <label className="span-2">Item
                <input list="bom-item-options" value={bomDraft.item} onChange={(event) => updateBomDraft("item", event.target.value)} />
                <datalist id="bom-item-options">
                  {bomItemSuggestions.map((item) => <option value={item} key={item} />)}
                </datalist>
              </label>
              <label>Number of items
                <input type="number" min="1" value={bomDraft.qty} onChange={(event) => updateBomDraft("qty", Number(event.target.value))} />
              </label>
              <label>Request speed
                <select value={bomDraft.requestSpeed} onChange={(event) => updateBomDraft("requestSpeed", event.target.value as BomLine["requestSpeed"])}>
                  <option>Standard</option>
                  <option>ASAP</option>
                  <option>Future</option>
                </select>
              </label>
              <fieldset className="span-2 material-action-group">
                <legend>Material action</legend>
                <label>
                  <input type="radio" name="bom-action" checked={bomDraft.action === "pull"} onChange={() => updateBomDraft("action", "pull")} />
                  <span><strong>Pull from inventory</strong><small>{selectedInventoryItem ? `${selectedInventoryItem.stock} available now` : "Not in inventory yet"}</small></span>
                </label>
                <label>
                  <input type="radio" name="bom-action" checked={bomDraft.action === "order"} onChange={() => updateBomDraft("action", "order")} />
                  <span><strong>Request warehouse stock order</strong><small>Procurement receives this into warehouse inventory</small></span>
                </label>
                <label>
                  <input type="radio" name="bom-action" checked={bomDraft.action === "direct"} onChange={() => updateBomDraft("action", "direct")} />
                  <span><strong>Request direct-to-project order</strong><small>Procurement receives this against the project, not warehouse stock</small></span>
                </label>
              </fieldset>
              <label className="span-2">Notes
                <textarea value={bomDraft.notes} onChange={(event) => updateBomDraft("notes", event.target.value)} placeholder="Install location, substitution notes, mounting details, or urgency." />
              </label>
            </div>

            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={closeBomModal}>Cancel</button>
              <button className="primary-action" type="button" onClick={addBomLine}>{editingBomIndex === null ? "Add Line Item" : "Save Line Item"}</button>
            </div>
          </section>
        </div>
      )}

      {showShippingModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-tile-close-row">
              <button className="icon-button" type="button" onClick={() => setShowShippingModal(false)} aria-label="Close">x</button>
            </div>
            <ProjectShippingSection
              project={selectedProject}
              onAddAddress={(address) => onAddProjectShippingAddress(selectedProject.ref, address)}
              onAddShipment={(addressId, addressSnapshot, notes, lines) => onAddProjectShipment(selectedProject.ref, addressId, addressSnapshot, notes, lines)}
              onMarkPacked={(shipmentId) => onMarkProjectShipmentPacked(selectedProject.ref, shipmentId)}
              onMarkShipped={(shipmentId, carrier, trackingNumber) => onMarkProjectShipmentShipped(selectedProject.ref, shipmentId, carrier, trackingNumber)}
              onUploadPhoto={(shipmentId, file, description) => onUploadProjectShipmentPhoto(selectedProject.ref, shipmentId, file, description)}
              onDeletePhoto={(shipmentId, photoId, storagePath) => onDeleteProjectShipmentPhoto(selectedProject.ref, shipmentId, photoId, storagePath)}
              onGetPhotoUrl={onGetProjectShipmentPhotoUrl}
            />
          </div>
        </div>
      )}

    </div>
  );
}

function priceTrend(part: Part) {
  const history = [...(part.priceHistory ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const latest = history[history.length - 1];
  const previous = history[history.length - 2];

  if (!latest) {
    return null;
  }

  const change = previous ? latest.unitCost - previous.unitCost : 0;
  const percent = previous && previous.unitCost > 0 ? (change / previous.unitCost) * 100 : 0;

  return { latest, previous, change, percent };
}

// Migration 073: renewal outreach tracker + recurring revenue outlook.
// "Active" for revenue purposes means a contract amount AND a start date
// are both set (saasStartDate only ever gets stamped once a project's
// status becomes Closed) -- a signed-but-not-yet-closed deal shouldn't
// count toward MRR/ARR. The 5-year outlook is a simple straight-line
// projection (today's ARR held flat for 5 years), not a growth model --
// labeled as such rather than pretending to forecast renewals/churn.
function SaasCalendar({ projectSites }: { projectSites: ProjectSite[] }) {
  const activeContracts = projectSites.filter((project) => project.saasContractAmount && project.saasStartDate);

  function monthlyAmount(project: ProjectSite) {
    const amount = project.saasContractAmount ?? 0;
    if (project.saasBillingFrequency === "Quarterly") return amount / 3;
    if (project.saasBillingFrequency === "Annual") return amount / 12;
    return amount;
  }

  const mrr = activeContracts.reduce((sum, project) => sum + monthlyAmount(project), 0);
  const quarterlyRevenue = mrr * 3;
  const arr = mrr * 12;
  const fiveYearOutlook = arr * 5;

  const upcoming = projectSites
    .filter((project) => project.saasRenewalDate)
    .slice()
    .sort((a, b) => (a.saasRenewalDate ?? "").localeCompare(b.saasRenewalDate ?? ""));

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in30Str = in30.toISOString().slice(0, 10);
  const in60 = new Date();
  in60.setDate(in60.getDate() + 60);
  const in60Str = in60.toISOString().slice(0, 10);

  function urgency(renewalDate: string) {
    if (renewalDate < today) return "overdue";
    if (renewalDate <= in30Str) return "soon";
    if (renewalDate <= in60Str) return "upcoming";
    return "later";
  }

  return (
    <div className="content-grid">
      <section className="panel full">
        <PanelHeader title="SaaS Calendar" label="Renewal outreach tracker and recurring revenue outlook" />
      </section>

      <div className="metric-grid">
        <div className="metric"><span>Monthly Recurring Revenue</span><strong>{money(mrr)}</strong></div>
        <div className="metric"><span>Quarterly</span><strong>{money(quarterlyRevenue)}</strong></div>
        <div className="metric"><span>Annual (ARR)</span><strong>{money(arr)}</strong></div>
        <div className="metric"><span>5-Year Outlook</span><strong>{money(fiveYearOutlook)}</strong></div>
      </div>

      <section className="panel full">
        <PanelHeader title="5-Year Revenue Outlook" label="Straight-line projection assuming today's active contracts continue at their current rate -- not a growth or churn model" />
        <div className="report-table compact-report-table">
          <div className="report-table-head"><span>Year</span><span>Projected Revenue</span></div>
          {Array.from({ length: 5 }, (_, index) => (
            <div className="report-table-row" key={index}>
              <span>Year {index + 1}</span>
              <span>{money(arr)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel full">
        <PanelHeader title="Renewal Calendar" label="Sorted soonest first -- reach out before these lapse" />
        <div className="report-table compact-report-table">
          <div className="report-table-head"><span>Project</span><span>SaaS Type</span><span>Start Date</span><span>Renewal Date</span><span>Contract</span></div>
          {upcoming.map((project) => (
            <div className={`report-table-row saas-urgency-${urgency(project.saasRenewalDate ?? "")}`} key={project.id ?? project.ref ?? project.name}>
              <span><strong>{project.name}</strong><small>{project.client}</small></span>
              <span data-label="SaaS Type">{project.saasType || "-"}</span>
              <span data-label="Start Date">{project.saasStartDate || "-"}</span>
              <span data-label="Renewal Date">{project.saasRenewalDate}</span>
              <span data-label="Contract">{project.saasContractAmount ? `${money(project.saasContractAmount)} / ${project.saasBillingFrequency || "Monthly"}` : "-"}</span>
            </div>
          ))}
          {upcoming.length === 0 && <div className="empty-compact-state">No SaaS renewal dates set yet -- add them from a project's SaaS tile.</div>}
        </div>
      </section>
    </div>
  );
}

function Reports({
  inventoryItems,
  deviceRecipes,
  inventoryValue,
  openPoValue,
  inventoryMovements,
  buildTransactions,
  projectAllocations,
  purchaseRequests,
  purchaseOrders,
  projectDocuments,
  searchFocus,
}: {
  inventoryItems: Part[];
  deviceRecipes: BuildRecipe[];
  inventoryValue: number;
  openPoValue: number;
  inventoryMovements: InventoryMovement[];
  buildTransactions: BuildTransaction[];
  projectAllocations: ProjectAllocationHistory[];
  purchaseRequests: PurchaseRequest[];
  purchaseOrders: PurchaseOrder[];
  projectDocuments: UploadedDoc[];
  searchFocus?: { term: string; token: number } | null;
}) {
  const [reportTab, setReportTab] = useState<"purchasing" | "inventory" | "manufacturing" | "activity" | "projects" | "documents">("purchasing");
  const [reportFilters, setReportFilters] = useState({ search: "", project: "All", vendor: "All", from: "", to: "" });
  useEffect(() => {
    if (!searchFocus) {
      return;
    }
    setReportTab("purchasing");
    setReportFilters((current) => ({ ...current, search: searchFocus.term, project: "All", vendor: "All" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFocus?.token]);
  const normalizedSearch = reportFilters.search.trim().toLowerCase();
  const inDateRange = (dateValue?: string) => {
    if (!dateValue) {
      return true;
    }
    const date = dateValue.slice(0, 10);
    return (!reportFilters.from || date >= reportFilters.from) && (!reportFilters.to || date <= reportFilters.to);
  };
  const matchesSearch = (...values: Array<string | number | undefined>) => !normalizedSearch || values.join(" ").toLowerCase().includes(normalizedSearch);
  const projectOptions = Array.from(new Set([
    ...purchaseOrders.map((order) => order.projectRef),
    ...purchaseRequests.map((request) => request.projectName).filter(Boolean),
    ...projectAllocations.map((allocation) => allocation.projectName),
    ...projectDocuments.map((doc) => doc.project),
  ] as string[])).sort();
  const vendorOptions = Array.from(new Set([
    ...purchaseOrders.map((order) => order.vendor),
    ...purchaseRequests.map((request) => request.preferredVendor).filter(Boolean),
    ...inventoryItems.map((part) => part.manufacturer).filter(Boolean),
  ] as string[])).sort();
  const filteredPurchaseOrders = purchaseOrders.filter((order) =>
    (reportFilters.project === "All" || order.projectRef === reportFilters.project) &&
    (reportFilters.vendor === "All" || order.vendor === reportFilters.vendor) &&
    inDateRange(order.date) &&
    matchesSearch(order.number, order.vendor, order.projectRef, order.sourceFile),
  );
  const filteredInventoryItems = inventoryItems.filter((part) =>
    (reportFilters.vendor === "All" || part.manufacturer === reportFilters.vendor || (part.purchaseUrls ?? []).some((source) => source.label === reportFilters.vendor)) &&
    matchesSearch(part.ref, part.name, part.description, part.manufacturer, part.category),
  );
  const filteredPurchaseRequests = purchaseRequests.filter((request) =>
    (reportFilters.project === "All" || request.projectName === reportFilters.project || request.sourceRef === reportFilters.project) &&
    (reportFilters.vendor === "All" || request.preferredVendor === reportFilters.vendor) &&
    inDateRange(request.createdAt) &&
    matchesSearch(request.requestNumber, request.sku, request.itemName, request.reason, request.status, request.projectName, request.preferredVendor),
  );
  const filteredProjectAllocations = projectAllocations.filter((allocation) =>
    (reportFilters.project === "All" || allocation.projectName === reportFilters.project || allocation.projectRef === reportFilters.project) &&
    inDateRange(allocation.createdAt) &&
    matchesSearch(allocation.projectName, allocation.projectRef, allocation.sku, allocation.itemName, allocation.action, allocation.notes),
  );
  const filteredInventoryMovements = inventoryMovements.filter((movement) =>
    (reportFilters.project === "All" || movement.projectName === reportFilters.project) &&
    inDateRange(movement.createdAt) &&
    matchesSearch(movement.sku, movement.itemName, movement.type, movement.projectName, movement.poNumber, movement.buildNumber, movement.notes),
  );
  const filteredProjectDocuments = projectDocuments.filter((doc) =>
    (reportFilters.project === "All" || doc.project === reportFilters.project) &&
    inDateRange(doc.uploadedAt) &&
    matchesSearch(doc.name, doc.project, doc.status, doc.type, doc.storage),
  );
  const filteredBuildTransactions = buildTransactions.filter((build) =>
    inDateRange(build.createdAt) &&
    matchesSearch(build.buildNumber, build.equipmentName, build.stage, build.status),
  );
  const vendorSpend = Object.entries(sumBy(filteredPurchaseOrders, (order) => order.vendor)).sort((a, b) => b[1] - a[1]);
  const projectSpend = Object.entries(sumBy(filteredPurchaseOrders, (order) => order.projectRef)).sort((a, b) => b[1] - a[1]);
  const categorySpend = filteredPurchaseOrders
    .flatMap((order) => order.lines)
    .reduce<Record<PurchaseLineCategory, number>>((totals, line) => {
      totals[line.category] = (totals[line.category] ?? 0) + lineTotal(line);
      return totals;
    }, {} as Record<PurchaseLineCategory, number>);
  const categoryRows = Object.entries(categorySpend).sort((a, b) => b[1] - a[1]);
  const largestCategory = Math.max(1, ...categoryRows.map(([, total]) => total));
  const costHistoryRows = filteredInventoryItems
    .map((part) => ({ part, trend: priceTrend(part) }))
    .filter((row): row is { part: Part; trend: NonNullable<ReturnType<typeof priceTrend>> } => Boolean(row.trend))
    .sort((a, b) => Math.abs(b.trend.change) - Math.abs(a.trend.change))
    .slice(0, 8);
  const sourceRows = filteredInventoryItems.filter((part) => (part.purchaseUrls ?? []).length > 0).slice(0, 8);
  const reorderRows = filteredInventoryItems.filter((part) => !part.retired && part.stock <= part.reorderPoint).sort((a, b) => a.stock - b.stock).slice(0, 12);
  const openPurchaseRequests = filteredPurchaseRequests.filter((request) => !["Received", "Cancelled"].includes(request.status));
  const purchaseRequestExposure = openPurchaseRequests.reduce((sum, request) => sum + Math.max(0, request.quantity - (request.receivedQuantity ?? 0)) * request.estimatedUnitCost, 0);
  const plannedBuildShortages = filteredBuildTransactions
    .filter((build) => build.status === "planned")
    .flatMap((build) => {
      const recipe = deviceRecipes.find((item) => item.outputName === build.equipmentName || item.name === build.equipmentName);
      if (!recipe) {
        return [{
          build,
          sku: "No recipe",
          itemName: build.equipmentName,
          required: build.quantityBuilt,
          available: 0,
          shortage: build.quantityBuilt,
        }];
      }

      return recipe.components
        .map((component) => {
          const part = inventoryItems.find((item) => item.name === component.itemName);
          const required = component.qty * build.quantityBuilt;
          const available = part && !part.retired ? part.stock : 0;
          return {
            build,
            sku: part?.ref ?? "No SKU",
            itemName: component.itemName,
            required,
            available,
            shortage: Math.max(0, required - available),
          };
        })
        .filter((row) => row.shortage > 0);
    })
    .slice(0, 14);
  function exportActiveReport() {
    const today = new Date().toISOString().slice(0, 10);
    if (reportTab === "purchasing") {
      exportCsv(
        `ergon-report-purchasing-${today}.csv`,
        openPurchaseRequests.map((request) => ({
          request: request.requestNumber,
          sku: request.sku,
          item: request.itemName,
          remaining: Math.max(0, request.quantity - (request.receivedQuantity ?? 0)),
          ordered: request.quantity,
          received: request.receivedQuantity ?? 0,
          reason: request.reason,
          status: request.status,
          source: request.sourceRef ?? "",
          project: request.projectName ?? "",
          procurement_track: request.procurementTrack ?? "warehouse_stock",
          vendor: request.preferredVendor ?? "",
          estimated_cost: Math.max(0, request.quantity - (request.receivedQuantity ?? 0)) * request.estimatedUnitCost,
        })),
      );
      return;
    }

    if (reportTab === "inventory") {
      exportCsv(
        `ergon-report-inventory-${today}.csv`,
        reorderRows.map((part) => ({
          sku: part.ref,
          item: part.name,
          stock: part.stock,
          reorder_point: part.reorderPoint,
          category: part.category,
          manufacturer: part.manufacturer,
          unit_cost: part.cost,
        })),
      );
      return;
    }

    if (reportTab === "manufacturing") {
      exportCsv(
        `ergon-report-manufacturing-${today}.csv`,
        filteredBuildTransactions.map((build) => ({
          build: build.buildNumber,
          equipment: build.equipmentName,
          quantity: build.quantityBuilt,
          stage: build.stage ?? "",
          status: build.status,
          created: build.createdAt,
          component_lines: build.componentMovements.length,
        })),
      );
      return;
    }

    if (reportTab === "activity") {
      exportCsv(
        `ergon-report-inventory-activity-${today}.csv`,
        filteredInventoryMovements.map((movement) => ({
          movement_id: movement.id,
          date: movement.createdAt,
          type: movement.type,
          sku: movement.sku,
          item: movement.itemName,
          quantity: movement.quantity,
          before: movement.quantityBefore,
          after: movement.quantityAfter,
          project: movement.projectName ?? "",
          po: movement.poNumber ?? "",
          build: movement.buildNumber ?? "",
          source: movement.source,
          notes: movement.notes,
        })),
      );
      return;
    }

    if (reportTab === "documents") {
      exportCsv(
        `ergon-report-documents-${today}.csv`,
        filteredProjectDocuments.map((doc) => ({
          project: doc.project,
          document: doc.name,
          type: doc.type ?? "",
          status: doc.status,
          storage: doc.storage ?? "",
          size: doc.size,
          uploaded_at: doc.uploadedAt ?? "",
          uploaded_by: doc.uploadedByEmail ?? "",
        })),
      );
      return;
    }

    exportCsv(
      `ergon-report-project-allocations-${today}.csv`,
        filteredProjectAllocations.map((allocation) => ({
        project: allocation.projectName,
        project_ref: allocation.projectRef ?? "",
        sku: allocation.sku,
        item: allocation.itemName,
        quantity: allocation.quantity,
        action: allocation.action,
        notes: allocation.notes,
        created: allocation.createdAt,
      })),
    );
  }

  return (
    <div className="content-grid">
      <section className="panel wide">
        <div className="panel-title-row">
          <div>
            <h2>Reports</h2>
            <p>Procurement, inventory, manufacturing, and project movement views.</p>
          </div>
          <button className="secondary-action" type="button" onClick={exportActiveReport}><FileText size={16} /> Export CSV</button>
        </div>
        <div className="segmented-tabs report-tabs">
          <button className={reportTab === "purchasing" ? "active" : ""} type="button" onClick={() => setReportTab("purchasing")}>Procurement</button>
          <button className={reportTab === "inventory" ? "active" : ""} type="button" onClick={() => setReportTab("inventory")}>Inventory</button>
          <button className={reportTab === "manufacturing" ? "active" : ""} type="button" onClick={() => setReportTab("manufacturing")}>Manufacturing</button>
          <button className={reportTab === "activity" ? "active" : ""} type="button" onClick={() => setReportTab("activity")}>Activity Ledger</button>
          <button className={reportTab === "projects" ? "active" : ""} type="button" onClick={() => setReportTab("projects")}>Projects</button>
          <button className={reportTab === "documents" ? "active" : ""} type="button" onClick={() => setReportTab("documents")}>Documents</button>
        </div>
        <div className="request-filter-row report-filter-row">
          <label>
            Search / SKU
            <input value={reportFilters.search} onChange={(event) => setReportFilters((current) => ({ ...current, search: event.target.value }))} placeholder="SKU, item, PO, project" />
          </label>
          <label>
            Project
            <select value={reportFilters.project} onChange={(event) => setReportFilters((current) => ({ ...current, project: event.target.value }))}>
              <option>All</option>
              {projectOptions.map((project) => <option key={project}>{project}</option>)}
            </select>
          </label>
          <label>
            Vendor
            <select value={reportFilters.vendor} onChange={(event) => setReportFilters((current) => ({ ...current, vendor: event.target.value }))}>
              <option>All</option>
              {vendorOptions.map((vendor) => <option key={vendor}>{vendor}</option>)}
            </select>
          </label>
          <label>
            From
            <input type="date" value={reportFilters.from} onChange={(event) => setReportFilters((current) => ({ ...current, from: event.target.value }))} />
          </label>
          <label>
            To
            <input type="date" value={reportFilters.to} onChange={(event) => setReportFilters((current) => ({ ...current, to: event.target.value }))} />
          </label>
          <button className="secondary-action mini-action" type="button" onClick={() => setReportFilters({ search: "", project: "All", vendor: "All", from: "", to: "" })}>Reset</button>
        </div>
      </section>
      {reportTab === "purchasing" && <>
        <section className="panel">
          <PanelHeader title="Project Spend" label="From recent order PDFs" />
          <div className="stack">
            {projectSpend.map(([project, total]) => <div className="row-card" key={project}><strong>{project}</strong><b>{moneyExact(total)}</b></div>)}
          </div>
        </section>
        <section className="panel">
          <PanelHeader title="Vendor Spend" label="NeweggBusiness and Amazon" />
          <div className="stack">
            {vendorSpend.map(([vendor, total]) => <div className="row-card" key={vendor}><strong>{vendor}</strong><b>{moneyExact(total)}</b></div>)}
          </div>
        </section>
        <section className="panel wide">
          <PanelHeader title="Purchase Category Mix" label="Line-item spend before tax" />
          <div className="bar-list">
            {categoryRows.map(([category, total]) => (
              <div className="bar-row" key={category}>
                <span>{category}</span>
                <div><i style={{ width: `${(total / largestCategory) * 100}%` }} /></div>
                <b>{moneyExact(total)}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="panel wide">
          <PanelHeader title="Open Purchase Requests" label="Reorder and manufacturing needs waiting on buying action" />
          <div className="snapshot-grid">
            <Metric icon={<ClipboardList size={20} />} label="Open Requests" value={String(openPurchaseRequests.length)} />
            <Metric icon={<DollarSign size={20} />} label="Estimated Exposure" value={moneyExact(purchaseRequestExposure)} />
          </div>
          <div className="report-table compact-report-table">
            <div className="report-table-head"><span>Request</span><span>Qty</span><span>Reason</span><span>Status</span><span>Est. Cost</span></div>
            {openPurchaseRequests.slice(0, 12).map((request) => (
              <div className="report-table-row" key={request.id}>
                <span><strong>{request.itemName}</strong><small>{request.requestNumber} - {request.sku}</small></span>
                <span data-label="Qty">{Math.max(0, request.quantity - (request.receivedQuantity ?? 0))}<small>of {request.quantity}</small></span>
                <span data-label="Reason">{request.reason}<small>{request.sourceRef ?? request.preferredVendor ?? "No source"}</small></span>
                <span data-label="Status" className="status warn">{request.status}</span>
                <span data-label="Est. Cost">{moneyExact(Math.max(0, request.quantity - (request.receivedQuantity ?? 0)) * request.estimatedUnitCost)}<small>{request.preferredVendor ?? "Vendor TBD"}</small></span>
              </div>
            ))}
            {openPurchaseRequests.length === 0 && <div className="empty-compact-state">No open purchase requests currently queued.</div>}
          </div>
        </section>
      </>}
      {reportTab === "inventory" && <>
        <section className="panel wide">
          <PanelHeader title="Reorder Watch" label="Parts at or below reorder point" />
          <div className="report-table compact-report-table">
            <div className="report-table-head"><span>SKU</span><span>Stock</span><span>Reorder</span><span>Status</span><span>Vendor</span></div>
            {reorderRows.map((part) => (
              <div className="report-table-row" key={part.ref}>
                <span><strong>{part.name}</strong><small>{part.ref}</small></span>
                <span data-label="Stock">{part.stock}</span>
                <span data-label="Reorder">{part.reorderPoint}</span>
                <span data-label="Status" className="status warn">Reorder</span>
                <span data-label="Vendor">{part.manufacturer}<small>{part.category}</small></span>
              </div>
            ))}
            {reorderRows.length === 0 && <div className="empty-compact-state">No inventory items are currently at reorder point.</div>}
          </div>
        </section>
        <section className="panel wide">
          <PanelHeader title="Inventory Cost History" label="Latest purchase price movement by item" />
          <div className="report-table compact-report-table">
            <div className="report-table-head"><span>Item</span><span>Latest</span><span>Previous</span><span>Change</span><span>Vendor</span></div>
            {costHistoryRows.map(({ part, trend }) => (
              <div className="report-table-row" key={part.ref}>
                <span><strong>{part.name}</strong><small>{part.ref}</small></span>
                <span data-label="Latest">{moneyExact(trend.latest.unitCost)}</span>
                <span data-label="Previous">{trend.previous ? moneyExact(trend.previous.unitCost) : "No prior"}</span>
                <span data-label="Change" className={trend.change > 0 ? "cost-up" : trend.change < 0 ? "cost-down" : ""}>{trend.change === 0 ? "Flat" : `${trend.change > 0 ? "+" : ""}${moneyExact(trend.change)} (${trend.percent.toFixed(1)}%)`}</span>
                <span data-label="Vendor">{trend.latest.vendor}<small>{trend.latest.date}</small></span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel wide">
          <PanelHeader title="Purchase Sources" label="Compact vendor link reference by inventory item" />
          <div className="source-report-grid">
            {sourceRows.map((part) => (
              <article className="source-report-card" key={part.ref}>
                <div><strong>{part.name}</strong><small>{part.ref} - {part.manufacturer}</small></div>
                <div className="source-chip-list">
                  {(part.purchaseUrls ?? []).map((source) =>
                    source.url ? <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><ExternalLink size={13} /> {source.label || "Source"}</a> : <span key={source.id}>{source.label || "Source pending"}</span>,
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel wide">
          <PanelHeader title="Ops Snapshot" label="Inventory plus captured purchasing" />
          <div className="report-total">{money(inventoryValue + openPoValue)}</div>
          <p className="muted">Current inventory value plus recent order PDFs now captured in Procurement.</p>
        </section>
      </>}
      {reportTab === "manufacturing" && <section className="panel wide">
        <PanelHeader title="Manufacturing History" label="Recent build transactions and ledger count" />
        <div className="snapshot-grid">
          <Metric icon={<Building2 size={20} />} label="Build Transactions" value={String(filteredBuildTransactions.length)} />
          <Metric icon={<ClipboardList size={20} />} label="Ledger Entries" value={String(filteredInventoryMovements.length)} />
          <Metric icon={<Boxes size={20} />} label="Project Allocations" value={String(filteredProjectAllocations.length)} />
        </div>
        <div className="report-table compact-report-table">
          <div className="report-table-head"><span>Build</span><span>Qty</span><span>Stage</span><span>Status</span><span>Date</span></div>
          {filteredBuildTransactions.slice(0, 12).map((build) => (
            <div className="report-table-row" key={build.id}>
              <span><strong>{build.equipmentName}</strong><small>{build.buildNumber}</small></span>
              <span data-label="Qty">{build.quantityBuilt}</span>
              <span data-label="Stage">{build.stage ?? "complete"}</span>
              <span data-label="Status">{build.status}</span>
              <span data-label="Date">{new Date(build.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {filteredBuildTransactions.length === 0 && <div className="empty-compact-state">No manufacturing transactions match the current filters.</div>}
        </div>
        <div className="report-section-divider" />
        <PanelHeader title="Planned Build Shortages" label="Parts blocking planned manufactured equipment" />
        <div className="report-table compact-report-table">
          <div className="report-table-head"><span>Build</span><span>SKU</span><span>Need</span><span>Have</span><span>Short</span></div>
          {plannedBuildShortages.map((row) => (
            <div className="report-table-row" key={`${row.build.id}-${row.sku}-${row.itemName}`}>
              <span><strong>{row.build.buildNumber}</strong><small>{row.build.equipmentName}</small></span>
              <span data-label="SKU">{row.sku}<small>{row.itemName}</small></span>
              <span data-label="Need">{row.required}</span>
              <span data-label="Have">{row.available}</span>
              <span data-label="Short" className="status warn">{row.shortage}</span>
            </div>
          ))}
          {plannedBuildShortages.length === 0 && <div className="empty-compact-state">No planned build shortages currently found.</div>}
        </div>
      </section>}
      {reportTab === "activity" && <section className="panel wide">
        <PanelHeader title="Inventory Activity Ledger" label="Chronological stock movements across receiving, transfers, builds, adjustments, retirements, and undo actions" />
        <div className="snapshot-grid">
          <Metric icon={<ClipboardList size={20} />} label="Movements" value={String(filteredInventoryMovements.length)} />
          <Metric icon={<Truck size={20} />} label="Receipts" value={String(filteredInventoryMovements.filter((movement) => movement.type === "receive").length)} />
          <Metric icon={<Boxes size={20} />} label="Build Actions" value={String(filteredInventoryMovements.filter((movement) => movement.type.startsWith("build")).length)} />
        </div>
        <div className="report-table compact-report-table">
          <div className="report-table-head"><span>Date</span><span>Movement</span><span>SKU / Item</span><span>Qty</span><span>Reference</span></div>
          {filteredInventoryMovements.slice(0, 24).map((movement) => (
            <div className="report-table-row" key={movement.id}>
              <span data-label="Date">{new Date(movement.createdAt).toLocaleString()}{movement.createdByEmail && <small>{movement.createdByEmail}</small>}</span>
              <span data-label="Movement"><strong>{movement.type.replace("_", " ")}</strong><small>{movement.source}</small></span>
              <span data-label="SKU / Item">{movement.sku}<small>{movement.itemName}</small></span>
              <span data-label="Qty">{movement.quantity}<small>{movement.quantityBefore} to {movement.quantityAfter}</small></span>
              <span data-label="Reference">{movement.projectName ?? movement.buildNumber ?? movement.poNumber ?? "No reference"}<small>{movement.notes}</small></span>
            </div>
          ))}
          {filteredInventoryMovements.length === 0 && <div className="empty-compact-state">No inventory movements match the current filters.</div>}
        </div>
      </section>}
      {reportTab === "projects" && <section className="panel wide">
        <PanelHeader title="Project Allocation History" label="Every SKU movement tied to a project" />
        <div className="report-table compact-report-table">
          <div className="report-table-head"><span>Project</span><span>SKU</span><span>Qty</span><span>Action</span><span>Notes</span></div>
          {filteredProjectAllocations.slice(0, 14).map((allocation) => (
            <div className="report-table-row" key={allocation.id}>
              <span><strong>{allocation.projectName}</strong><small>{allocation.projectRef ?? "No PRJ"}</small></span>
              <span data-label="SKU">{allocation.sku}<small>{allocation.itemName}</small></span>
              <span data-label="Qty">{allocation.quantity}</span>
              <span data-label="Action">{allocation.action}</span>
              <span data-label="Notes">{allocation.notes}<small>{new Date(allocation.createdAt).toLocaleString()}</small></span>
            </div>
          ))}
          {filteredProjectAllocations.length === 0 && <div className="empty-compact-state">No project allocations match the current filters.</div>}
        </div>
      </section>}
      {reportTab === "documents" && <section className="panel wide">
        <PanelHeader title="Document Storage Report" label="Project files, review status, and backup destination" />
        <div className="snapshot-grid">
          <Metric icon={<FileText size={20} />} label="Documents" value={String(projectDocuments.length)} />
          <Metric icon={<FolderOpen size={20} />} label="Backed Up" value={String(projectDocuments.filter((doc) => doc.status === "Backed up").length)} />
          <Metric icon={<Upload size={20} />} label="Needs Review" value={String(projectDocuments.filter((doc) => doc.status === "Uploaded" || doc.status === "Ready to review").length)} />
        </div>
        <div className="report-table compact-report-table">
          <div className="report-table-head"><span>Project</span><span>Document</span><span>Type</span><span>Status</span><span>Uploaded</span></div>
          {filteredProjectDocuments.slice(0, 16).map((doc) => (
            <div className="report-table-row" key={`${doc.id}-${doc.name}`}>
              <span data-label="Project">{doc.project}</span>
              <span><strong>{doc.name}</strong><small>{doc.size ? formatBytes(doc.size) : "No file size saved"} - {doc.storage ?? "Browser"}</small></span>
              <span data-label="Type">{doc.type ?? "Project"}</span>
              <span data-label="Status">{doc.status}</span>
              <span data-label="Uploaded">{doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString() : "No timestamp"}<small>{doc.uploadedByEmail || "Uploader not saved"}</small></span>
            </div>
          ))}
          {filteredProjectDocuments.length === 0 && <div className="empty-compact-state">No project documents match the current filters.</div>}
        </div>
      </section>}
    </div>
  );
}

const ROLE_KEY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "warehouse", label: "Warehouse" },
  { value: "purchasing", label: "Procurement" },
  { value: "pm", label: "PM" },
  { value: "manager", label: "Manager" },
  { value: "sales", label: "Sales" },
  { value: "engineering", label: "Engineering" },
  { value: "product_development", label: "Product Development" },
  { value: "implementation", label: "Implementation" },
  { value: "support", label: "Support" },
  { value: "marketing", label: "Marketing" },
];

// A plain `new Date("2026-08-20").toISOString()` parses the date-only string
// as UTC midnight -- for anyone west of UTC (all of the US), that's already
// hours in the past in their own timezone the moment they pick "today,"
// which made a freshly-approved user look "Access expired" almost
// immediately. Anchoring to the END of that day in the browser's local
// timezone instead means "expires on this date" behaves the way an admin
// actually reading the calendar would expect.
function expiresOnToIsoEndOfDay(dateOnly: string): string | null {
  if (!dateOnly) {
    return null;
  }
  const [year, month, day] = dateOnly.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

function PendingApprovalRow({
  user,
  onApprove,
  onDeny,
}: {
  user: KnownUser;
  onApprove: (roleKey: string, expiresAt: string | null) => void;
  onDeny: () => void;
}) {
  const [roleKey, setRoleKey] = useState("warehouse");
  const [expiresOn, setExpiresOn] = useState("");

  return (
    <tr>
      <td>{user.email}</td>
      <td>
        <select value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
          {ROLE_KEY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </td>
      <td><input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></td>
      <td>
        <button className="primary-action mini-action" type="button" onClick={() => onApprove(roleKey, expiresOnToIsoEndOfDay(expiresOn))}>Approve</button>
        <button className="secondary-action mini-action" type="button" onClick={onDeny}>Deny</button>
      </td>
    </tr>
  );
}

// One editable card per shared Proposal Template section (Admin ->
// Proposal Template). Local draft state + save-on-blur, same reasoning as
// the Catalog "Details" specification inputs -- these are long boilerplate
// paragraphs, not something to PATCH on every keystroke.
function ProposalTemplateSectionEditor({
  section,
  onSave,
}: {
  section: ProposalTemplateSection;
  onSave: (id: string, updates: Partial<{ title: string; body: string; sequenceOrder: number }>) => void;
}) {
  const [titleDraft, setTitleDraft] = useState(section.title);
  const [bodyDraft, setBodyDraft] = useState(section.body);

  useEffect(() => {
    setTitleDraft(section.title);
    setBodyDraft(section.body);
  }, [section.id, section.title, section.body]);

  return (
    <div className="proposal-template-section-editor">
      <input
        className="proposal-template-title-input"
        value={titleDraft}
        onChange={(event) => setTitleDraft(event.target.value)}
        onBlur={() => {
          if (titleDraft.trim() && titleDraft !== section.title) {
            onSave(section.id, { title: titleDraft.trim() });
          }
        }}
      />
      <textarea
        rows={6}
        value={bodyDraft}
        onChange={(event) => setBodyDraft(event.target.value)}
        onBlur={() => {
          if (bodyDraft !== section.body) {
            onSave(section.id, { body: bodyDraft });
          }
        }}
      />
    </div>
  );
}

// Phase 18 Fluid Form Engine editor -- generic over any form_schema (After-
// Sales Handover, Site Intake Questionnaire, ...), since form_schemas/
// form_schema_fields are keyed by form_key rather than tied to one
// specific form. Extracted out once a second schema needed this exact
// same table + add-question row, rather than duplicating the JSX.
function FormBuilderPanel({
  title,
  label,
  schema,
  status,
  defaultSection,
  onAddField,
  onUpdateField,
  onDeleteField,
  onReorderField,
}: {
  title: string;
  label: string;
  schema: FormSchema | null;
  status: string;
  defaultSection: string;
  onAddField: (field: Omit<FormSchemaField, "id" | "formSchemaId">) => void;
  onUpdateField: (id: string, patch: Partial<Omit<FormSchemaField, "id" | "formSchemaId">>) => void;
  onDeleteField: (id: string) => void;
  onReorderField: (id: string, direction: "up" | "down") => void;
}) {
  const [draft, setDraft] = useState({ section: defaultSection, label: "", fieldType: "text" as FormSchemaField["fieldType"], placeholder: "", isRequired: false, optionsRaw: "" });

  return (
    <section className="panel wide">
      <PanelHeader title={title} label={label} />
      {status && <small className="muted">{status}</small>}
      {!schema ? (
        <div className="empty-compact-state">Loading form schema...</div>
      ) : (
        <>
          <table className="stack-table-mobile">
            <thead><tr><th>#</th><th>Section</th><th>Label</th><th>Type</th><th>Required</th><th></th></tr></thead>
            <tbody>
              {[...schema.fields].sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((field, index, sorted) => (
                <tr key={field.id}>
                  <td data-label="#">{field.sequenceOrder}</td>
                  <td data-label="Section">{field.section}</td>
                  <td>{field.label}{field.fieldType === "select" && field.options.length > 0 ? ` [${field.options.join(" | ")}]` : ""}</td>
                  <td data-label="Type">{field.fieldType}</td>
                  <td data-label="Required">
                    <label className="checkbox-inline">
                      <input type="checkbox" checked={field.isRequired} onChange={(event) => onUpdateField(field.id, { isRequired: event.target.checked })} />
                    </label>
                  </td>
                  <td>
                    <button className="secondary-action mini-action" type="button" disabled={index === 0} onClick={() => onReorderField(field.id, "up")}>&uarr;</button>{" "}
                    <button className="secondary-action mini-action" type="button" disabled={index === sorted.length - 1} onClick={() => onReorderField(field.id, "down")}>&darr;</button>{" "}
                    <button className="secondary-action mini-action" type="button" onClick={() => onDeleteField(field.id)}>Remove</button>
                  </td>
                </tr>
              ))}
              {schema.fields.length === 0 && <tr><td colSpan={6} className="empty-compact-state">No questions yet.</td></tr>}
            </tbody>
          </table>
          <div className="roster-add-row">
            <input value={draft.section} onChange={(event) => setDraft((current) => ({ ...current, section: event.target.value }))} placeholder={`Section (e.g. ${defaultSection})`} />
            <input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Question label" />
            <select value={draft.fieldType} onChange={(event) => setDraft((current) => ({ ...current, fieldType: event.target.value as FormSchemaField["fieldType"] }))}>
              <option value="text">Text</option>
              <option value="textarea">Paragraph</option>
              <option value="number">Number</option>
              <option value="select">Dropdown</option>
              <option value="checkbox">Checkbox</option>
              <option value="date">Date</option>
            </select>
            {draft.fieldType === "select" ? (
              <input value={draft.optionsRaw} onChange={(event) => setDraft((current) => ({ ...current, optionsRaw: event.target.value }))} placeholder="Option A, Option B, Option C" />
            ) : (
              <input value={draft.placeholder} onChange={(event) => setDraft((current) => ({ ...current, placeholder: event.target.value }))} placeholder="Placeholder text" />
            )}
            <label className="checkbox-inline-field">
              <input type="checkbox" checked={draft.isRequired} onChange={(event) => setDraft((current) => ({ ...current, isRequired: event.target.checked }))} />
              Required
            </label>
            <button
              className="primary-action mini-action"
              type="button"
              disabled={!draft.label.trim()}
              onClick={() => {
                onAddField({
                  section: draft.section || "general",
                  fieldKey: `field_${Date.now().toString(36)}`,
                  label: draft.label,
                  fieldType: draft.fieldType,
                  placeholder: draft.placeholder,
                  isRequired: draft.isRequired,
                  options: draft.fieldType === "select" ? draft.optionsRaw.split(",").map((option) => option.trim()).filter(Boolean) : [],
                  sequenceOrder: schema.fields.length,
                });
                setDraft({ section: draft.section, label: "", fieldType: "text", placeholder: "", isRequired: false, optionsRaw: "" });
              }}
            >
              <Plus size={14} /> Add Question
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// Learning Library -- reached via the book icon next to Cloud Sync in the
// top nav. The user guides themselves ("this is where the user guides will
// live") don't exist yet, so this is an honest empty state per category
// rather than fake placeholder articles -- it's a real, working page (back
// button, real category list matching the app's actual sections) that's
// ready for real content to be dropped in later.
const LIBRARY_CATEGORIES = ["Getting Started", "Dashboard", "Inventory", "Procurement", "Projects", "Sales & Site Builder", "Tasks", "Reports"];

function LibraryPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="content-grid">
      <section className="panel wide">
        <div className="panel-title-row">
          <div>
            <h2>Learning Library</h2>
            <p>User guides and walkthroughs, organized by section.</p>
          </div>
          <button className="secondary-action mini-action" type="button" onClick={onBack}>Back</button>
        </div>
        <div className="library-category-grid">
          {LIBRARY_CATEGORIES.map((category) => (
            <div className="library-category-card" key={category}>
              <BookOpen size={18} />
              <strong>{category}</strong>
              <span className="muted">Guides coming soon</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// First-login welcome walkthrough. Shows exactly once per account (see
// app_user_status.has_seen_welcome, migration 043) -- skippable, and the
// last slide always finishes it. Slide copy is v1 and can be revised later
// without touching the mechanism (show-once / skip / finish) that runs it.
function WelcomeSlideshow({
  companyName,
  allowedTabs,
  onFinish,
}: {
  companyName: string;
  allowedTabs: View[];
  onFinish: () => void;
}) {
  const [slideIndex, setSlideIndex] = useState(0);
  const tabList = allowedTabs.filter((tab) => tab !== "admin" && tab !== "library").map((tab) => TAB_LABELS[tab]).join(", ");

  const slides = [
    {
      title: `Welcome to ${companyName} Ops`,
      body: "This is a quick walkthrough of the basics before you dive in. It only takes a minute.",
    },
    {
      title: "Find your way around",
      body: tabList ? `Based on your role, you have access to: ${tabList}. You can always get back to any of these from the top navigation bar.` : "Use the top navigation bar to move between sections.",
    },
    {
      title: "Stay on top of tasks",
      body: "Tasks can be assigned to you individually or to your whole team. The bell icon in the top right shows notifications the moment something needs your attention.",
    },
    {
      title: "Need help later?",
      body: "The book icon next to Cloud Sync opens the Learning Library, where guides for every section will live. You're all set -- let's get started.",
    },
  ];

  const isLast = slideIndex === slides.length - 1;
  const slide = slides[slideIndex];

  return (
    <div className="auth-gate">
      <div className="auth-gate-card welcome-slideshow-card">
        <img className="auth-gate-logo" src="/ergon-logo.png" alt={companyName} />
        <h2>{slide.title}</h2>
        <p className="muted">{slide.body}</p>
        <div className="welcome-slideshow-dots">
          {slides.map((_, index) => (
            <span key={index} className={`welcome-slideshow-dot ${index === slideIndex ? "active" : ""}`} />
          ))}
        </div>
        <div className="auth-gate-actions">
          {!isLast && (
            <button className="secondary-action" type="button" onClick={onFinish}>Skip</button>
          )}
          {slideIndex > 0 && (
            <button className="secondary-action" type="button" onClick={() => setSlideIndex((index) => index - 1)}>Back</button>
          )}
          <button className="primary-action" type="button" onClick={() => (isLast ? onFinish() : setSlideIndex((index) => index + 1))}>
            {isLast ? "Get Started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminPage({
  currentUserId,
  isAdmin,
  isManagerRole,
  knownUsers,
  userRoleMap,
  adminIds,
  allowedViewsMap,
  approvalStatuses,
  status,
  approvalStatusMessage,
  onSetRole,
  onSetSecondaryRoles,
  onGrantAdmin,
  onRevokeAdmin,
  onSetAllowedViews,
  onReviewApproval,
  onRefresh,
  branding,
  brandingStatus,
  onSaveCompanyName,
  onUploadLogo,
  teamMembers,
  teamMemberStatus,
  onAddTeamMember,
  onUpdateTeamMember,
  notificationRules,
  onUpdateNotificationRule,
  standardInstallTimes,
  onSaveStandardInstallTime,
  scheduleTemplates,
  onCreateScheduleTemplate,
  onAddSchedulePhase,
  onDeleteSchedulePhase,
  handoverSchema,
  formBuilderStatus,
  onAddFormField,
  onUpdateFormField,
  onDeleteFormField,
  onReorderFormField,
  siteIntakeSchema,
  siteIntakeFormBuilderStatus,
  onAddSiteIntakeField,
  onUpdateSiteIntakeField,
  onDeleteSiteIntakeField,
  onReorderSiteIntakeField,
  presalesRules,
  presalesStatus,
  onAddPresalesRule,
  onDeletePresalesRule,
  siteHardwareRules,
  siteHardwareRuleStatus,
  onAddSiteHardwareRule,
  onUpdateSiteHardwareRule,
  onDeleteSiteHardwareRule,
  catalogPriceChangeRequests,
  catalogItems,
  catalogPriceChangeStatus,
  onApproveCatalogPriceChange,
  onRejectCatalogPriceChange,
  invites,
  inviteStatus,
  onSendInvite,
  onResendInvite,
  onRevokeInvite,
  onSendPasswordReset,
  proposalTemplateSections,
  onUpdateProposalTemplateSection,
}: {
  currentUserId: string;
  isAdmin: boolean;
  isManagerRole: boolean;
  knownUsers: KnownUser[];
  userRoleMap: Record<string, UserRoles>;
  adminIds: string[];
  allowedViewsMap: Record<string, string[] | null>;
  approvalStatuses: UserStatus[];
  status: string;
  approvalStatusMessage: string;
  onSetRole: (userId: string, roleKey: string) => void;
  onSetSecondaryRoles: (userId: string, roleKeys: string[]) => void;
  onGrantAdmin: (userId: string) => void;
  onRevokeAdmin: (userId: string) => void;
  onSetAllowedViews: (userId: string, views: string[] | null) => void;
  onReviewApproval: (userId: string, status: ApprovalStatus, expiresAt: string | null) => void;
  onRefresh: () => void;
  branding: CompanyBranding;
  brandingStatus: string;
  onSaveCompanyName: (name: string) => void;
  onUploadLogo: (file: File) => void;
  teamMembers: TeamMember[];
  teamMemberStatus: string;
  onAddTeamMember: (member: Omit<TeamMember, "id">) => void;
  onUpdateTeamMember: (id: string, member: Partial<Omit<TeamMember, "id">>) => void;
  notificationRules: NotificationRule[];
  onUpdateNotificationRule: (id: string, patch: Partial<Pick<NotificationRule, "channels" | "isActive">>) => void;
  standardInstallTimes: StandardInstallTime[];
  onSaveStandardInstallTime: (entry: Omit<StandardInstallTime, "id">) => void;
  scheduleTemplates: ScheduleTemplate[];
  onCreateScheduleTemplate: (name: string, description: string) => void;
  onAddSchedulePhase: (templateId: string, phase: Omit<ScheduleTemplatePhase, "id" | "templateId">) => void;
  onDeleteSchedulePhase: (templateId: string, phaseId: string) => void;
  handoverSchema: FormSchema | null;
  formBuilderStatus: string;
  onAddFormField: (field: Omit<FormSchemaField, "id" | "formSchemaId">) => void;
  onUpdateFormField: (id: string, patch: Partial<Omit<FormSchemaField, "id" | "formSchemaId">>) => void;
  onDeleteFormField: (id: string) => void;
  onReorderFormField: (id: string, direction: "up" | "down") => void;
  siteIntakeSchema: FormSchema | null;
  siteIntakeFormBuilderStatus: string;
  onAddSiteIntakeField: (field: Omit<FormSchemaField, "id" | "formSchemaId">) => void;
  onUpdateSiteIntakeField: (id: string, patch: Partial<Omit<FormSchemaField, "id" | "formSchemaId">>) => void;
  onDeleteSiteIntakeField: (id: string) => void;
  onReorderSiteIntakeField: (id: string, direction: "up" | "down") => void;
  presalesRules: PresalesHardwareRule[];
  presalesStatus: string;
  onAddPresalesRule: (rule: Omit<PresalesHardwareRule, "id">) => void;
  onDeletePresalesRule: (id: string) => void;
  siteHardwareRules: SiteHardwareRule[];
  siteHardwareRuleStatus: string;
  onAddSiteHardwareRule: (rule: Omit<SiteHardwareRule, "id">) => void;
  onUpdateSiteHardwareRule: (id: string, patch: Partial<Omit<SiteHardwareRule, "id">>) => void;
  onDeleteSiteHardwareRule: (id: string) => void;
  catalogPriceChangeRequests: CatalogPriceChangeRequest[];
  catalogItems: CatalogItem[];
  catalogPriceChangeStatus: string;
  onApproveCatalogPriceChange: (request: CatalogPriceChangeRequest) => void;
  onRejectCatalogPriceChange: (request: CatalogPriceChangeRequest) => void;
  invites: UserInvite[];
  inviteStatus: string;
  onSendInvite: (input: { email: string; fullName: string; primaryRole: string; secondaryRoles: string[] }) => void;
  onResendInvite: (invite: UserInvite) => void;
  onRevokeInvite: (id: string) => void;
  onSendPasswordReset: (email: string) => Promise<boolean>;
  proposalTemplateSections: ProposalTemplateSection[];
  onUpdateProposalTemplateSection: (id: string, updates: Partial<{ title: string; body: string; sequenceOrder: number }>) => void;
}) {
  const [rosterDraft, setRosterDraft] = useState({ fullName: "", email: "", primaryRole: "", secondaryRoles: [] as string[] });
  const [editingRosterId, setEditingRosterId] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState("");
  const [passwordResetFeedback, setPasswordResetFeedback] = useState<{ email: string; ok: boolean } | null>(null);
  const knownUserByEmail = new Map(knownUsers.map((user) => [user.email.toLowerCase(), user]));

  async function triggerPasswordReset(email: string) {
    const ok = await onSendPasswordReset(email);
    setPasswordResetFeedback({ email, ok });
    setTimeout(() => {
      setPasswordResetFeedback((current) => (current?.email === email ? null : current));
    }, 2500);
  }
  const [timeDraft, setTimeDraft] = useState({ category: "", hoursPerUnit: 0, notes: "" });
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [phaseDrafts, setPhaseDrafts] = useState<Record<string, { phaseName: string; durationMode: "fixed_hours" | "per_bom_unit"; fixedHours: number; bomCategoryFilter: string; defaultRole: string }>>({});
  const [presalesRuleDraft, setPresalesRuleDraft] = useState({ tier: "", baseItemName: "", quantityMode: "fixed" as PresalesHardwareRule["quantityMode"], fixedQty: 1, perNodeDivisor: 16, requiresCloudSync: "any" as "any" | "yes" | "no" });
  const [siteHardwareRuleDraft, setSiteHardwareRuleDraft] = useState({ metric: "lpr" as SiteHardwareMetric, itemName: "", qtyPerUnit: 1, notes: "" });

  function phaseDraftFor(templateId: string) {
    return phaseDrafts[templateId] ?? { phaseName: "", durationMode: "fixed_hours" as const, fixedHours: 4, bomCategoryFilter: "", defaultRole: "" };
  }

  function submitRosterDraft() {
    const email = rosterDraft.email.trim();
    if (!email || !rosterDraft.primaryRole) {
      return;
    }
    const roleLabel = ROLE_KEY_OPTIONS.find((option) => option.value === rosterDraft.primaryRole)?.label ?? rosterDraft.primaryRole;
    onAddTeamMember({
      fullName: rosterDraft.fullName.trim(),
      email,
      roleTitle: roleLabel,
      isActive: true,
      primaryRole: rosterDraft.primaryRole,
      secondaryRoles: rosterDraft.secondaryRoles,
    });
    onSendInvite({ email, fullName: rosterDraft.fullName.trim(), primaryRole: rosterDraft.primaryRole, secondaryRoles: rosterDraft.secondaryRoles });
    setRosterDraft({ fullName: "", email: "", primaryRole: "", secondaryRoles: [] });
  }

  // A roster row's "groups" can be edited even before the person has ever
  // logged in (team_members.primary_role/secondary_roles). If they've since
  // confirmed their invite and are a real logged-in account (matched by
  // email), also push the same change into the real user_roles system so
  // the two stay in sync instead of silently drifting apart.
  function updateRosterRoles(member: TeamMember, patch: Partial<{ primaryRole: string; secondaryRoles: string[] }>) {
    const nextPrimary = patch.primaryRole !== undefined ? patch.primaryRole : member.primaryRole;
    const nextSecondary = patch.secondaryRoles !== undefined ? patch.secondaryRoles : member.secondaryRoles;
    const roleLabel = ROLE_KEY_OPTIONS.find((option) => option.value === nextPrimary)?.label ?? nextPrimary;
    onUpdateTeamMember(member.id, { primaryRole: nextPrimary, secondaryRoles: nextSecondary, roleTitle: roleLabel });
    const linkedUser = member.email ? knownUserByEmail.get(member.email.toLowerCase()) : undefined;
    if (linkedUser) {
      if (patch.primaryRole !== undefined) {
        onSetRole(linkedUser.userId, patch.primaryRole);
      }
      if (patch.secondaryRoles !== undefined) {
        onSetSecondaryRoles(linkedUser.userId, patch.secondaryRoles);
      }
    }
  }

  const [companyNameDraft, setCompanyNameDraft] = useState(branding.companyName);
  useEffect(() => {
    setCompanyNameDraft(branding.companyName);
  }, [branding.companyName]);
  const logoUrl = branding.logoStoragePath ? companyLogoUrl(branding.logoStoragePath) : null;

  // Pre-Sales Rules are authored against real Sales-maintained categories
  // instead of a freeform "tier" string an admin has to invent and keep
  // consistent -- as soon as a product in the catalog has a Category, it
  // shows up here.
  const catalogCategories = Array.from(new Set(catalogItems.map((item) => item.category.trim()).filter(Boolean))).sort();

  const usersByid = new Map(knownUsers.map((user) => [user.userId, user]));
  const approvalByUserId = new Map(approvalStatuses.map((entry) => [entry.userId, entry]));
  const pendingUsers = approvalStatuses
    .filter((entry) => entry.approvalStatus === "pending" && !adminIds.includes(entry.userId))
    .map((entry) => usersByid.get(entry.userId))
    .filter((user): user is KnownUser => Boolean(user));

  return (
    <div className="content-grid">
      {isAdmin && (
        <section className="panel wide">
          <PanelHeader title="Company Branding" label="Shown in the top nav -- change these to reuse this app for a different company" />
          <div className="branding-editor-row">
            <div className="branding-logo-block">
              {logoUrl ? <img className="branding-logo-preview" src={logoUrl} alt={branding.companyName} /> : <div className="branding-logo-placeholder">No logo yet</div>}
              <label className="secondary-action mini-action hidden-file-label">
                Upload logo
                <input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) { onUploadLogo(file); } event.target.value = ""; }} />
              </label>
            </div>
            <label className="branding-name-field">Company name
              <div className="branding-name-row">
                <input value={companyNameDraft} onChange={(event) => setCompanyNameDraft(event.target.value)} placeholder="Company name" />
                <button className="primary-action mini-action" type="button" disabled={!companyNameDraft.trim() || companyNameDraft === branding.companyName} onClick={() => onSaveCompanyName(companyNameDraft.trim())}>
                  Save
                </button>
              </div>
            </label>
          </div>
          {brandingStatus && <small className="muted">{brandingStatus}</small>}
        </section>
      )}

      <section className="panel wide">
        <PanelHeader title="Pending Approvals" label="New sign-ins wait here until a Manager or Admin lets them in" />
        <div className="report-filter-row">
          <button className="secondary-action mini-action" type="button" onClick={onRefresh}>Refresh</button>
          {approvalStatusMessage && <span className="muted">{approvalStatusMessage}</span>}
        </div>
        <table className="stack-table-mobile">
          <thead>
            <tr>
              <th>Email</th>
              <th>Assign role</th>
              <th>Expires (optional)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pendingUsers.map((user) => (
              <PendingApprovalRow
                key={user.userId}
                user={user}
                onApprove={(roleKey, expiresAt) => {
                  onSetRole(user.userId, roleKey);
                  onReviewApproval(user.userId, "approved", expiresAt);
                }}
                onDeny={() => onReviewApproval(user.userId, "denied", null)}
              />
            ))}
            {pendingUsers.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-compact-state">No one is waiting for approval.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {(isAdmin || isManagerRole) && (
        <>
        <section className="panel wide">
          <PanelHeader title="Team Roster" label="Invite teammates by email -- they must confirm before they can sign in. Click a row to assign their group(s)." />
          <div className="report-filter-row">
            {teamMemberStatus && <span className="muted">{teamMemberStatus}</span>}
            {inviteStatus && <span className="muted">{inviteStatus}</span>}
          </div>
          {isAdmin && (
            <>
              <div className="roster-add-row">
                <input value={rosterDraft.fullName} onChange={(event) => setRosterDraft((current) => ({ ...current, fullName: event.target.value }))} placeholder="Full name (optional)" />
                <input value={rosterDraft.email} onChange={(event) => setRosterDraft((current) => ({ ...current, email: event.target.value }))} placeholder="Email (required)" type="email" />
                <select value={rosterDraft.primaryRole} onChange={(event) => setRosterDraft((current) => ({ ...current, primaryRole: event.target.value, secondaryRoles: current.secondaryRoles.filter((key) => key !== event.target.value) }))}>
                  <option value="">Group (required)</option>
                  {ROLE_KEY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button className="primary-action mini-action" type="button" onClick={submitRosterDraft} disabled={!rosterDraft.email.trim() || !rosterDraft.primaryRole}>
                  <Plus size={14} /> Send Invite
                </button>
              </div>
              {rosterDraft.primaryRole && (
                <div className="secondary-role-picker">
                  <span className="muted">Also part of:</span>
                  <div className="tag-picker-grid">
                    {ROLE_KEY_OPTIONS.filter((option) => option.value !== rosterDraft.primaryRole).map((option) => (
                      <label key={option.value} className="checkbox-inline">
                        <input
                          type="checkbox"
                          checked={rosterDraft.secondaryRoles.includes(option.value)}
                          onChange={(event) => {
                            setRosterDraft((current) => {
                              const next = new Set(current.secondaryRoles);
                              if (event.target.checked) {
                                next.add(option.value);
                              } else {
                                next.delete(option.value);
                              }
                              return { ...current, secondaryRoles: Array.from(next) };
                            });
                          }}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          <div className="table-scroll">
          <table className="stack-table-mobile">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Group(s)</th>
                <th>Invite status</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((member) => {
                const matchingInvite = member.email
                  ? invites.find((invite) => invite.email.toLowerCase() === member.email.toLowerCase())
                  : undefined;
                const isLoggedIn = member.email ? knownUserByEmail.has(member.email.toLowerCase()) : false;
                const inviteStatusLabel = isLoggedIn
                  ? "Confirmed"
                  : matchingInvite
                    ? (matchingInvite.status === "pending" ? "Waiting on confirmation" : matchingInvite.status === "accepted" ? "Confirmed" : "Revoked")
                    : "-";
                const isEditing = editingRosterId === member.id;
                return (
                  <Fragment key={member.id}>
                    <tr className="clickable-row" onClick={() => setEditingRosterId(isEditing ? null : member.id)}>
                      <td>{member.fullName || "-"}</td>
                      <td>{member.email || "-"}</td>
                      <td>
                        {member.primaryRole
                          ? [member.primaryRole, ...member.secondaryRoles]
                              .map((key) => ROLE_KEY_OPTIONS.find((option) => option.value === key)?.label ?? key)
                              .join(", ")
                          : "-"}
                      </td>
                      <td>{inviteStatusLabel}</td>
                      <td>{member.isActive ? "Active" : "Inactive"}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {isAdmin && matchingInvite && matchingInvite.status === "pending" && (
                          <>
                            <button className="secondary-action mini-action" type="button" onClick={() => onResendInvite(matchingInvite)}>Resend</button>
                            <button
                              className={`secondary-action mini-action ${copiedInviteId === matchingInvite.id ? "just-copied" : ""}`}
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(`${window.location.origin}/?invite=${matchingInvite.token}`).then(() => {
                                  setCopiedInviteId(matchingInvite.id);
                                  setTimeout(() => setCopiedInviteId(""), 2000);
                                });
                              }}
                            >
                              {copiedInviteId === matchingInvite.id ? "Copied!" : "Copy link"}
                            </button>
                            <button className="secondary-action mini-action" type="button" onClick={() => onRevokeInvite(matchingInvite.id)}>Revoke</button>
                          </>
                        )}
                        {isAdmin && !matchingInvite && !isLoggedIn && (
                          // Roster members added before this invite system existed
                          // (or an invite that got revoked) have no invite record at
                          // all -- give the admin a way to send one retroactively
                          // instead of them being stuck with no path to a real login.
                          <button
                            className="secondary-action mini-action"
                            type="button"
                            disabled={!member.email.trim() || !member.primaryRole}
                            title={!member.email.trim() ? "Add an email first" : !member.primaryRole ? "Assign a group first (click the row)" : undefined}
                            onClick={() => onSendInvite({ email: member.email.trim(), fullName: member.fullName, primaryRole: member.primaryRole, secondaryRoles: member.secondaryRoles })}
                          >
                            Send Invite
                          </button>
                        )}
                        {isAdmin && isLoggedIn && member.email && (
                          <button
                            className={`secondary-action mini-action ${passwordResetFeedback?.email === member.email ? (passwordResetFeedback.ok ? "just-copied" : "just-failed") : ""}`}
                            type="button"
                            onClick={() => triggerPasswordReset(member.email)}
                          >
                            {passwordResetFeedback?.email === member.email ? (passwordResetFeedback.ok ? "Sent!" : "Failed") : "Reset password"}
                          </button>
                        )}
                        <button className="secondary-action mini-action" type="button" onClick={() => onUpdateTeamMember(member.id, { isActive: !member.isActive })}>
                          {member.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr>
                        <td colSpan={6}>
                          <div className="secondary-role-picker">
                            <span className="muted">Primary group:</span>
                            <select
                              value={member.primaryRole}
                              onChange={(event) => updateRosterRoles(member, { primaryRole: event.target.value })}
                            >
                              <option value="" disabled>Not set</option>
                              {ROLE_KEY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </div>
                          {member.primaryRole && (
                            <div className="secondary-role-picker">
                              <span className="muted">Also part of:</span>
                              <div className="tag-picker-grid">
                                {ROLE_KEY_OPTIONS.filter((option) => option.value !== member.primaryRole).map((option) => (
                                  <label key={option.value} className="checkbox-inline">
                                    <input
                                      type="checkbox"
                                      checked={member.secondaryRoles.includes(option.value)}
                                      onChange={(event) => {
                                        const next = new Set(member.secondaryRoles);
                                        if (event.target.checked) {
                                          next.add(option.value);
                                        } else {
                                          next.delete(option.value);
                                        }
                                        updateRosterRoles(member, { secondaryRoles: Array.from(next) });
                                      }}
                                    />
                                    {option.label}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {teamMembers.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-compact-state">No one on the roster yet. Invite teammates above so tasks can be assigned to them.</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </section>

        <section className="panel wide">
          <PanelHeader title="Notification Rules" label="Which channel(s) fire for each event -- programmable, no code change needed" />
          <table className="stack-table-mobile">
            <thead>
              <tr>
                <th>Event</th>
                <th>In-app bell</th>
                <th>Email</th>
                <th>Slack / Teams</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {notificationRules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.eventType.replace(/_/g, " ")}</td>
                  <td data-label="In-app bell"><input type="checkbox" checked={rule.channels.includes("in_app")} onChange={(event) => onUpdateNotificationRule(rule.id, { channels: event.target.checked ? [...rule.channels, "in_app"] : rule.channels.filter((c) => c !== "in_app") })} /></td>
                  <td data-label="Email"><input type="checkbox" checked={rule.channels.includes("email")} title="Sends a real email via Resend when this event fires" onChange={(event) => onUpdateNotificationRule(rule.id, { channels: event.target.checked ? [...rule.channels, "email"] : rule.channels.filter((c) => c !== "email") })} /></td>
                  <td data-label="Slack / Teams"><input type="checkbox" checked={rule.channels.includes("slack")} title="Posts to Slack/Teams once SLACK_WEBHOOK_URL is set in Vercel" onChange={(event) => onUpdateNotificationRule(rule.id, { channels: event.target.checked ? [...rule.channels, "slack"] : rule.channels.filter((c) => c !== "slack") })} /></td>
                  <td data-label="Active"><input type="checkbox" checked={rule.isActive} onChange={(event) => onUpdateNotificationRule(rule.id, { isActive: event.target.checked })} /></td>
                </tr>
              ))}
              {notificationRules.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-compact-state">No notification rules loaded.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel wide">
          <PanelHeader title="Standard Install Times" label="Hours per unit, by inventory category -- powers schedule generation" />
          <div className="roster-add-row">
            <input value={timeDraft.category} onChange={(event) => setTimeDraft((current) => ({ ...current, category: event.target.value }))} placeholder="Category (e.g. Communications)" />
            <input type="number" min={0} step="0.25" value={timeDraft.hoursPerUnit} onChange={(event) => setTimeDraft((current) => ({ ...current, hoursPerUnit: Number(event.target.value) }))} placeholder="Hours per unit" />
            <input value={timeDraft.notes} onChange={(event) => setTimeDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes (optional)" />
            <button className="primary-action mini-action" type="button" disabled={!timeDraft.category.trim()} onClick={() => { onSaveStandardInstallTime(timeDraft); setTimeDraft({ category: "", hoursPerUnit: 0, notes: "" }); }}>
              <Plus size={14} /> Save
            </button>
          </div>
          <table className="stack-table-mobile">
            <thead><tr><th>Category</th><th>Hours / unit</th><th>Notes</th></tr></thead>
            <tbody>
              {standardInstallTimes.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.category}</td>
                  <td data-label="Hours / unit">{entry.hoursPerUnit}</td>
                  <td data-label="Notes">{entry.notes || "-"}</td>
                </tr>
              ))}
              {standardInstallTimes.length === 0 && (
                <tr><td colSpan={3} className="empty-compact-state">No standard times set yet -- schedule generation needs at least one category defined here.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel wide">
          <PanelHeader title="Project Schedule Templates" label="Ordered phases a PM can apply to a project to auto-draft a schedule" />
          <div className="roster-add-row">
            <input value={templateNameDraft} onChange={(event) => setTemplateNameDraft(event.target.value)} placeholder="New template name (e.g. Standard Parking Garage Install)" className="span-2" />
            <button className="primary-action mini-action" type="button" disabled={!templateNameDraft.trim()} onClick={() => { onCreateScheduleTemplate(templateNameDraft, ""); setTemplateNameDraft(""); }}>
              <Plus size={14} /> New Template
            </button>
          </div>
          {scheduleTemplates.map((template) => {
            const draft = phaseDraftFor(template.id);
            return (
              <div className="schedule-template-block" key={template.id}>
                <div className="panel-title-row">
                  <div><h2>{template.name}</h2><p>{template.phases.length} phase(s)</p></div>
                </div>
                <table className="stack-table-mobile">
                  <thead><tr><th>#</th><th>Phase</th><th>Duration</th><th>Role</th><th></th></tr></thead>
                  <tbody>
                    {[...template.phases].sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((phase) => (
                      <tr key={phase.id}>
                        <td data-label="#">{phase.sequenceOrder}</td>
                        <td>{phase.phaseName}</td>
                        <td data-label="Duration">{phase.durationMode === "fixed_hours" ? `${phase.fixedHours ?? 0}h fixed` : `per BOM unit (${phase.bomCategoryFilter})`}</td>
                        <td data-label="Role">{phase.defaultRole || "-"}</td>
                        <td><button className="secondary-action mini-action" type="button" onClick={() => onDeleteSchedulePhase(template.id, phase.id)}>Remove</button></td>
                      </tr>
                    ))}
                    {template.phases.length === 0 && <tr><td colSpan={5} className="empty-compact-state">No phases yet.</td></tr>}
                  </tbody>
                </table>
                <div className="roster-add-row">
                  <input value={draft.phaseName} onChange={(event) => setPhaseDrafts((current) => ({ ...current, [template.id]: { ...draft, phaseName: event.target.value } }))} placeholder="Phase name (e.g. Camera Install)" />
                  <select value={draft.durationMode} onChange={(event) => setPhaseDrafts((current) => ({ ...current, [template.id]: { ...draft, durationMode: event.target.value as "fixed_hours" | "per_bom_unit" } }))}>
                    <option value="fixed_hours">Fixed hours</option>
                    <option value="per_bom_unit">Per BOM unit (by category)</option>
                  </select>
                  {draft.durationMode === "fixed_hours" ? (
                    <input type="number" min={0} step="0.5" value={draft.fixedHours} onChange={(event) => setPhaseDrafts((current) => ({ ...current, [template.id]: { ...draft, fixedHours: Number(event.target.value) } }))} placeholder="Hours" />
                  ) : (
                    <input value={draft.bomCategoryFilter} onChange={(event) => setPhaseDrafts((current) => ({ ...current, [template.id]: { ...draft, bomCategoryFilter: event.target.value } }))} placeholder="BOM category (e.g. Communications)" />
                  )}
                  <select value={draft.defaultRole} onChange={(event) => setPhaseDrafts((current) => ({ ...current, [template.id]: { ...draft, defaultRole: event.target.value } }))}>
                    <option value="">No default role</option>
                    {ROLE_KEY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button
                    className="primary-action mini-action"
                    type="button"
                    disabled={!draft.phaseName.trim()}
                    onClick={() => {
                      onAddSchedulePhase(template.id, {
                        phaseName: draft.phaseName,
                        sequenceOrder: template.phases.length + 1,
                        durationMode: draft.durationMode,
                        fixedHours: draft.durationMode === "fixed_hours" ? draft.fixedHours : null,
                        bomCategoryFilter: draft.durationMode === "per_bom_unit" ? draft.bomCategoryFilter : "",
                        defaultRole: draft.defaultRole,
                      });
                      setPhaseDrafts((current) => ({ ...current, [template.id]: { phaseName: "", durationMode: "fixed_hours", fixedHours: 4, bomCategoryFilter: "", defaultRole: "" } }));
                    }}
                  >
                    <Plus size={14} /> Add Phase
                  </button>
                </div>
              </div>
            );
          })}
          {scheduleTemplates.length === 0 && <div className="empty-compact-state">No templates yet. Create one above, then add phases to it.</div>}
        </section>

        <FormBuilderPanel
          title="Form Builder - After-Sales Handover"
          label="Add, edit, reorder, or remove handover questions with no code change"
          schema={handoverSchema}
          status={formBuilderStatus}
          defaultSection="site_requirements"
          onAddField={onAddFormField}
          onUpdateField={onUpdateFormField}
          onDeleteField={onDeleteFormField}
          onReorderField={onReorderFormField}
        />

        <FormBuilderPanel
          title="Form Builder - Site Intake Questionnaire"
          label="Questions a sales rep asks the client while scoping a new site (Site Builder). Add, edit, reorder, or remove with no code change."
          schema={siteIntakeSchema}
          status={siteIntakeFormBuilderStatus}
          defaultSection="client_details"
          onAddField={onAddSiteIntakeField}
          onUpdateField={onUpdateSiteIntakeField}
          onDeleteField={onDeleteSiteIntakeField}
          onReorderField={onReorderSiteIntakeField}
        />

        <section className="panel wide">
          <PanelHeader title="Pre-Sales Rules" label="Baseline hardware derived from Product Catalog category, node count, and cloud sync at the quoting stage. Add categories to products in the Sales Catalog first -- they show up here automatically." />
          {presalesStatus && <small className="muted">{presalesStatus}</small>}
          {catalogCategories.length === 0 && (
            <p className="muted">No categories found yet -- add a Category to at least one product in the Sales Catalog to start building rules here.</p>
          )}
          <table className="stack-table-mobile">
            <thead><tr><th>Category</th><th>Item</th><th>Quantity</th><th>Cloud Sync</th><th></th></tr></thead>
            <tbody>
              {presalesRules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.tier}</td>
                  <td>{rule.baseItemName}</td>
                  <td data-label="Quantity">{rule.quantityMode === "per_node_ceil" ? `ceil(nodes / ${rule.perNodeDivisor})` : `${rule.fixedQty} fixed`}</td>
                  <td data-label="Cloud Sync">{rule.requiresCloudSync === null ? "Any" : rule.requiresCloudSync ? "Required" : "No"}</td>
                  <td><button className="secondary-action mini-action" type="button" onClick={() => onDeletePresalesRule(rule.id)}>Remove</button></td>
                </tr>
              ))}
              {presalesRules.length === 0 && <tr><td colSpan={5} className="empty-compact-state">No rules yet.</td></tr>}
            </tbody>
          </table>
          <div className="roster-add-row">
            <select value={presalesRuleDraft.tier} onChange={(event) => setPresalesRuleDraft((current) => ({ ...current, tier: event.target.value }))}>
              <option value="">Select category...</option>
              {catalogCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <input value={presalesRuleDraft.baseItemName} onChange={(event) => setPresalesRuleDraft((current) => ({ ...current, baseItemName: event.target.value }))} placeholder="Inventory item name" />
            <select value={presalesRuleDraft.quantityMode} onChange={(event) => setPresalesRuleDraft((current) => ({ ...current, quantityMode: event.target.value as PresalesHardwareRule["quantityMode"] }))}>
              <option value="fixed">Fixed quantity</option>
              <option value="per_node_ceil">Per node (rounded up)</option>
            </select>
            {presalesRuleDraft.quantityMode === "fixed" ? (
              <input type="number" min={1} value={presalesRuleDraft.fixedQty} onChange={(event) => setPresalesRuleDraft((current) => ({ ...current, fixedQty: Number(event.target.value) }))} />
            ) : (
              <input type="number" min={1} value={presalesRuleDraft.perNodeDivisor} onChange={(event) => setPresalesRuleDraft((current) => ({ ...current, perNodeDivisor: Number(event.target.value) }))} placeholder="Nodes per unit" />
            )}
            <select value={presalesRuleDraft.requiresCloudSync} onChange={(event) => setPresalesRuleDraft((current) => ({ ...current, requiresCloudSync: event.target.value as "any" | "yes" | "no" }))}>
              <option value="any">Cloud sync: any</option>
              <option value="yes">Cloud sync: required</option>
              <option value="no">Cloud sync: no</option>
            </select>
            <button
              className="primary-action mini-action"
              type="button"
              disabled={!presalesRuleDraft.tier.trim() || !presalesRuleDraft.baseItemName.trim()}
              onClick={() => {
                onAddPresalesRule({
                  tier: presalesRuleDraft.tier,
                  baseItemName: presalesRuleDraft.baseItemName,
                  quantityMode: presalesRuleDraft.quantityMode,
                  fixedQty: presalesRuleDraft.fixedQty,
                  perNodeDivisor: presalesRuleDraft.quantityMode === "per_node_ceil" ? presalesRuleDraft.perNodeDivisor : null,
                  requiresCloudSync: presalesRuleDraft.requiresCloudSync === "any" ? null : presalesRuleDraft.requiresCloudSync === "yes",
                  sequenceOrder: presalesRules.length,
                  isActive: true,
                });
                setPresalesRuleDraft({ tier: presalesRuleDraft.tier, baseItemName: "", quantityMode: "fixed", fixedQty: 1, perNodeDivisor: 16, requiresCloudSync: "any" });
              }}
            >
              <Plus size={14} /> Add Rule
            </button>
          </div>
        </section>

        <section className="panel wide">
          <PanelHeader title="Site Hardware Rules" label="v1 hardware recommendation for Site Builder locations -- FLI/LPR/People Counting checkboxes and entry/exit/level counts drive quantities. Tune these as real numbers come in." />
          {siteHardwareRuleStatus && <small className="muted">{siteHardwareRuleStatus}</small>}
          <table className="stack-table-mobile">
            <thead><tr><th>Metric</th><th>Item</th><th>Qty per unit</th><th>Notes</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {siteHardwareRules.map((rule) => (
                <tr key={rule.id}>
                  <td>{SITE_HARDWARE_METRIC_OPTIONS.find((option) => option.value === rule.metric)?.label ?? rule.metric}</td>
                  <td>{rule.itemName}</td>
                  <td data-label="Qty per unit">
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={rule.qtyPerUnit}
                      onChange={(event) => onUpdateSiteHardwareRule(rule.id, { qtyPerUnit: Number(event.target.value) || 0 })}
                    />
                  </td>
                  <td data-label="Notes">{rule.notes || "-"}</td>
                  <td data-label="Active"><input type="checkbox" checked={rule.isActive} onChange={(event) => onUpdateSiteHardwareRule(rule.id, { isActive: event.target.checked })} /></td>
                  <td><button className="secondary-action mini-action" type="button" onClick={() => onDeleteSiteHardwareRule(rule.id)}>Remove</button></td>
                </tr>
              ))}
              {siteHardwareRules.length === 0 && <tr><td colSpan={6} className="empty-compact-state">No rules yet.</td></tr>}
            </tbody>
          </table>
          <div className="roster-add-row">
            <select value={siteHardwareRuleDraft.metric} onChange={(event) => setSiteHardwareRuleDraft((current) => ({ ...current, metric: event.target.value as SiteHardwareMetric }))}>
              {SITE_HARDWARE_METRIC_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <input value={siteHardwareRuleDraft.itemName} onChange={(event) => setSiteHardwareRuleDraft((current) => ({ ...current, itemName: event.target.value }))} placeholder="Item name (e.g. LPR Camera)" />
            <input type="number" min={0} step="0.5" value={siteHardwareRuleDraft.qtyPerUnit} onChange={(event) => setSiteHardwareRuleDraft((current) => ({ ...current, qtyPerUnit: Number(event.target.value) || 0 }))} placeholder="Qty per unit" />
            <input value={siteHardwareRuleDraft.notes} onChange={(event) => setSiteHardwareRuleDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes (optional)" />
            <button
              className="primary-action mini-action"
              type="button"
              disabled={!siteHardwareRuleDraft.itemName.trim()}
              onClick={() => {
                onAddSiteHardwareRule({
                  metric: siteHardwareRuleDraft.metric,
                  itemName: siteHardwareRuleDraft.itemName,
                  qtyPerUnit: siteHardwareRuleDraft.qtyPerUnit,
                  notes: siteHardwareRuleDraft.notes,
                  sequenceOrder: siteHardwareRules.length,
                  isActive: true,
                });
                setSiteHardwareRuleDraft({ metric: siteHardwareRuleDraft.metric, itemName: "", qtyPerUnit: 1, notes: "" });
              }}
            >
              <Plus size={14} /> Add Rule
            </button>
          </div>
        </section>

        <section className="panel wide">
          <PanelHeader title="Proposal Template" label="Shared boilerplate sent with every Quote Proposal -- Assumptions, Warranty, Payment Terms, etc. Seeded from EnSight's real proposal wording; edit here and every future proposal picks up the change." />
          <div className="proposal-template-list">
            {proposalTemplateSections
              .slice()
              .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
              .map((section) => (
                <ProposalTemplateSectionEditor key={section.id} section={section} onSave={onUpdateProposalTemplateSection} />
              ))}
            {proposalTemplateSections.length === 0 && <p className="empty-compact-state">No template sections yet -- run migration 053.</p>}
          </div>
        </section>
        </>
      )}

      {(isAdmin || isManagerRole) && (
        <section className="panel wide">
          <PanelHeader title="Catalog Price Change Requests" label="Sales reps have no direct write access to the catalog -- their cost/markup/price edits land here for approval, then get applied automatically once approved." />
          {catalogPriceChangeStatus && <small className="muted">{catalogPriceChangeStatus}</small>}
          <table className="stack-table-mobile">
            <thead>
              <tr>
                <th>Product</th>
                <th>Requested by</th>
                <th>Field</th>
                <th>From</th>
                <th>To</th>
                <th>Reason</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {catalogPriceChangeRequests.map((request) => {
                const item = catalogItems.find((entry) => entry.id === request.catalogItemId);
                return (
                  <tr key={request.id}>
                    <td>{item?.productName ?? "(deleted item)"}</td>
                    <td data-label="Requested by">{request.requestedByEmail}</td>
                    <td data-label="Field">{request.fieldChanged.replace(/_/g, " ")}</td>
                    <td data-label="From">{request.previousValue}</td>
                    <td data-label="To">{request.requestedValue}</td>
                    <td data-label="Reason">{request.reason || "-"}</td>
                    <td data-label="Status">{request.status}{request.reviewedByEmail ? ` by ${request.reviewedByEmail}` : ""}</td>
                    <td>
                      {request.status === "pending" && (
                        <>
                          <button className="secondary-action mini-action" type="button" onClick={() => onApproveCatalogPriceChange(request)}>Approve</button>
                          <button className="secondary-action mini-action" type="button" onClick={() => onRejectCatalogPriceChange(request)}>Reject</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {catalogPriceChangeRequests.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-compact-state">No price change requests yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {isAdmin && (
        <section className="panel wide">
          <PanelHeader title="Admin" label="Assign roles, tab access, and admin rights for every user who has signed in" />
          <div className="report-filter-row">
            <button className="secondary-action mini-action" type="button" onClick={onRefresh}>Refresh directory</button>
            {status && <span className="muted">{status}</span>}
          </div>
          <table className="stack-table-mobile">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Tab access</th>
                <th>Admin</th>
                <th>Password</th>
                <th>Approval</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {knownUsers.map((user) => {
                const isUserAdmin = adminIds.includes(user.userId);
                const approval = approvalByUserId.get(user.userId);
                const override = allowedViewsMap[user.userId] ?? null;
                const roles = userRoleMap[user.userId] ?? { primary: "", secondary: [] };
                const roleKeysForDefaults = roles.primary ? [roles.primary, ...roles.secondary] : ["warehouse"];
                const defaultViews = Array.from(new Set(roleKeysForDefaults.flatMap((key) => DEFAULT_TABS_BY_ROLE[key as RoleMode] ?? [])));
                const effectiveViews = override && override.length > 0 ? override : defaultViews;
                return (
                  <tr key={user.userId}>
                    <td>{user.email}{user.userId === currentUserId ? " (you)" : ""}</td>
                    <td>
                      <select
                        value={roles.primary}
                        onChange={(event) => onSetRole(user.userId, event.target.value)}
                      >
                        <option value="" disabled>Not set</option>
                        {ROLE_KEY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      {roles.primary && (
                        <div className="secondary-role-picker">
                          <span className="muted">Also part of:</span>
                          <div className="tag-picker-grid">
                            {ROLE_KEY_OPTIONS.filter((option) => option.value !== roles.primary).map((option) => (
                              <label key={option.value} className="checkbox-inline">
                                <input
                                  type="checkbox"
                                  checked={roles.secondary.includes(option.value)}
                                  onChange={(event) => {
                                    const next = new Set(roles.secondary);
                                    if (event.target.checked) {
                                      next.add(option.value);
                                    } else {
                                      next.delete(option.value);
                                    }
                                    onSetSecondaryRoles(user.userId, Array.from(next));
                                  }}
                                />
                                {option.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="tab-permission-grid">
                        {ALL_TABS.map((tab) => (
                          <label key={tab} className="checkbox-inline">
                            <input
                              type="checkbox"
                              checked={effectiveViews.includes(tab)}
                              onChange={(event) => {
                                const next = new Set(effectiveViews);
                                if (event.target.checked) {
                                  next.add(tab);
                                } else {
                                  next.delete(tab);
                                }
                                onSetAllowedViews(user.userId, Array.from(next));
                              }}
                            />
                            {TAB_LABELS[tab]}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      {isUserAdmin ? (
                        <button
                          className="secondary-action mini-action"
                          type="button"
                          onClick={() => onRevokeAdmin(user.userId)}
                          disabled={user.userId === currentUserId}
                        >
                          Remove admin
                        </button>
                      ) : (
                        <button className="secondary-action mini-action" type="button" onClick={() => onGrantAdmin(user.userId)}>
                          Make admin
                        </button>
                      )}
                    </td>
                    <td>
                      <button
                        className={`secondary-action mini-action ${passwordResetFeedback?.email === user.email ? (passwordResetFeedback.ok ? "just-copied" : "just-failed") : ""}`}
                        type="button"
                        onClick={() => triggerPasswordReset(user.email)}
                      >
                        {passwordResetFeedback?.email === user.email ? (passwordResetFeedback.ok ? "Sent!" : "Failed") : "Send reset"}
                      </button>
                    </td>
                    <td>
                      {approval?.approvalStatus ?? "-"}
                      {approval?.expiresAt ? ` (until ${new Date(approval.expiresAt).toLocaleDateString()})` : ""}
                      {approval?.approvalStatus === "approved" && approval.expiresAt && (
                        <button
                          className="secondary-action mini-action"
                          type="button"
                          title="Clears the expiration date -- access won't expire again unless you set a new date."
                          onClick={() => onReviewApproval(user.userId, "approved", null)}
                        >
                          Renew (clear expiration)
                        </button>
                      )}
                    </td>
                    <td>{new Date(user.lastSeenAt).toLocaleString()}</td>
                  </tr>
                );
              })}
              {knownUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-compact-state">
                    No users have signed in yet. Users appear here automatically the first time they sign in.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {!isAdmin && isManagerRole && (
        <section className="panel wide">
          <p className="muted">Full role and tab-access management is limited to Admins. As a Manager, you can approve or deny new sign-ins above.</p>
        </section>
      )}
    </div>
  );
}

// Sales page host: splits Product Catalog (an admin/manager-maintained
// reference list) from the Quote Builder (a sales-authored workflow) into
// sub-tabs, same segmented-tabs pattern Reports uses for its own sub-views.
function SalesHome({
  catalogItems,
  catalogStatus,
  isConfigured,
  canManageCatalog,
  onCreateCatalogItem,
  onUpdateCatalogItem,
  onSetCatalogItemRetired,
  onBulkImportCatalogItems,
  onRefreshCatalog,
  onUploadCatalogDatasheet,
  inventoryItems,
  currentUserEmail,
  priceChangeRequests,
  priceChangeStatus,
  onProposePriceChange,
  salesQuotes,
  salesQuoteStatus,
  onCreateSalesQuote,
  onAddSalesQuoteLocation,
  onUpdateSalesQuoteLocation,
  onDeleteSalesQuoteLocation,
  onAddSalesQuoteLocationItem,
  onUpdateSalesQuoteLocationItem,
  onDeleteSalesQuoteLocationItem,
  onPullLocationHardwareIntoQuoteBom,
  onUpdateSalesQuoteStatus,
  onDeleteSalesQuote,
  onCreateProjectFromClosedWonQuote,
  onAddSalesQuoteBomLines,
  onDeleteSalesQuoteBomLine,
  onUpdateSalesQuoteBomLineCatalogLink,
  onUpdateSalesQuoteProposalFields,
  onUpdateSalesQuoteInfo,
  siteIntakeSchema,
  quoteIntakeResponses,
  quoteIntakeStatus,
  onLoadSalesQuoteIntakeResponse,
  onSaveSalesQuoteIntakeResponses,
  quoteProposals,
  quoteProposalStatus,
  onLoadQuoteProposals,
  onCreateQuoteProposal,
  presalesRules,
  presalesStatus,
  onGenerateBaselineBomForQuote,
  onUploadSalesQuoteImage,
  onUpdateSalesQuoteImageDescription,
  onUpdateSalesQuoteImageMeta,
  onMoveSalesQuoteImage,
  onDownloadSalesQuoteImage,
  onDeleteSalesQuoteImage,
  onGetSalesQuoteImageUrl,
  siteHardwareRules,
  projectSites,
  tasks,
  taskActivity,
  teamMembers,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onOpenTasksView,
}: {
  catalogItems: CatalogItem[];
  catalogStatus: string;
  isConfigured: boolean;
  canManageCatalog: boolean;
  onCreateCatalogItem: (item: Omit<CatalogItem, "id" | "catalogNumber">) => void;
  onUpdateCatalogItem: (id: string, item: Omit<CatalogItem, "id">) => void;
  onSetCatalogItemRetired: (id: string, retired: boolean) => void;
  onBulkImportCatalogItems: (items: Array<Omit<CatalogItem, "id" | "catalogNumber">>) => Promise<number>;
  onRefreshCatalog: () => void;
  onUploadCatalogDatasheet: (catalogItemId: string, file: File) => Promise<string | null>;
  inventoryItems: Part[];
  currentUserEmail: string;
  priceChangeRequests: CatalogPriceChangeRequest[];
  priceChangeStatus: string;
  onProposePriceChange: (catalogItemId: string, fieldChanged: CatalogPriceChangeField, previousValue: number, requestedValue: number, reason: string) => void;
  salesQuotes: SalesQuote[];
  salesQuoteStatus: string;
  onCreateSalesQuote: (input: NewSiteInput) => void;
  onAddSalesQuoteLocation: (quoteId: string, locationType: "garage" | "lot") => void;
  onUpdateSalesQuoteLocation: (
    quoteId: string,
    locationId: string,
    updates: Partial<{
      name: string;
      fli: boolean;
      lpr: boolean;
      peopleCounting: boolean;
      fliCameraItemId: string | null;
      lprCameraItemId: string | null;
      peopleCountingCameraItemId: string | null;
      entriesCount: number;
      exitsCount: number;
      levelsCount: number;
    }>,
  ) => void;
  onDeleteSalesQuoteLocation: (quoteId: string, locationId: string) => void;
  onAddSalesQuoteLocationItem: (quoteId: string, locationId: string, lineType: SalesQuoteLocationItem["lineType"], catalogItemId: string, qty: number, extra?: { locationLabel?: string; accessoryCatalogItemId?: string | null; accessoryQty?: number }) => void;
  onUpdateSalesQuoteLocationItem: (quoteId: string, locationId: string, itemId: string, updates: Partial<{ qty: number; locationLabel: string; accessoryCatalogItemId: string | null; accessoryQty: number }>) => void;
  onDeleteSalesQuoteLocationItem: (quoteId: string, locationId: string, itemId: string) => void;
  onPullLocationHardwareIntoQuoteBom: (quoteId: string) => void;
  onUpdateSalesQuoteStatus: (quoteId: string, status: SalesQuote["status"]) => void;
  onDeleteSalesQuote: (quoteId: string) => void;
  onCreateProjectFromClosedWonQuote: (quote: SalesQuote) => Promise<ProjectSite | null>;
  onAddSalesQuoteBomLines: (quoteId: string, lines: Array<{ item: string; qty: number; notes?: string; catalogItemId?: string | null }>) => void;
  onDeleteSalesQuoteBomLine: (quoteId: string, lineId: string) => void;
  onUpdateSalesQuoteBomLineCatalogLink: (quoteId: string, lineId: string, catalogItemId: string | null) => void;
  onUpdateSalesQuoteProposalFields: (quoteId: string, updates: Partial<{ clientEmail: string; proposalSummary: string }>) => void;
  onUpdateSalesQuoteInfo: (
    quoteId: string,
    updates: Partial<{ clientName: string; siteName: string; city: string; clientEmail: string; contactFullName: string; contactPhone: string; preferredCommunication: string }>,
  ) => void;
  siteIntakeSchema: FormSchema | null;
  quoteIntakeResponses: Record<string, SalesQuoteIntakeResponse>;
  quoteIntakeStatus: string;
  onLoadSalesQuoteIntakeResponse: (quoteId: string) => void;
  onSaveSalesQuoteIntakeResponses: (quoteId: string, responses: Record<string, string>) => void;
  quoteProposals: SalesQuoteProposal[];
  quoteProposalStatus: string;
  onLoadQuoteProposals: (quoteId: string) => void;
  onCreateQuoteProposal: (quote: SalesQuote) => void;
  presalesRules: PresalesHardwareRule[];
  presalesStatus: string;
  onGenerateBaselineBomForQuote: (quoteId: string, tier: string, nodeCount: number, cloudSync: boolean) => void;
  onUploadSalesQuoteImage: (
    quoteId: string,
    locationId: string,
    imageType: "photo" | "drawing",
    file: File,
    description?: string,
    coords?: { lat: number; lng: number } | null,
  ) => Promise<boolean>;
  onUpdateSalesQuoteImageDescription: (quoteId: string, locationId: string, imageId: string, description: string) => void;
  onUpdateSalesQuoteImageMeta: (quoteId: string, locationId: string, imageId: string, updates: { fileName: string; description: string }) => Promise<boolean>;
  onMoveSalesQuoteImage: (quoteId: string, fromLocationId: string, imageId: string, targetLocationId: string) => Promise<boolean>;
  onDownloadSalesQuoteImage: (image: SalesQuoteLocationImage) => void;
  onDeleteSalesQuoteImage: (quoteId: string, locationId: string, imageId: string, storagePath: string) => Promise<boolean>;
  onGetSalesQuoteImageUrl: (image: SalesQuoteLocationImage) => Promise<string | null>;
  siteHardwareRules: SiteHardwareRule[];
  projectSites: ProjectSite[];
  tasks: EOTask[];
  taskActivity: TaskActivityEntry[];
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">) => Promise<boolean>;
  onUpdateTask: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => Promise<boolean>;
  onDeleteTask: (id: string) => void;
  onOpenTasksView: () => void;
}) {
  // One combined review panel for both Catalog and Quote Builder tasks --
  // no Add here (that lives inside each area below, see RequestTaskButton),
  // this is purely "what's still open, across Sales, for a quick reference."
  const combinedSalesTasks = tasks.filter((task) => task.section === "sales_catalog" || task.section === "sales_quotes");

  const currentYear = new Date().getFullYear();
  const openQuoteCount = salesQuotes.filter((quote) => quote.status === "open").length;
  const closedThisYearQuotes = salesQuotes.filter(
    (quote) => quote.status !== "open" && quote.closedAt && new Date(quote.closedAt).getFullYear() === currentYear,
  );
  const catalogItemById = new Map(catalogItems.map((item) => [item.id, item]));
  // Estimated profit only counts BOM lines linked to a real Product Catalog
  // item (unit cost x markup are known there) -- free-text lines like
  // "Project Management Hours" have no cost data to estimate from, so they
  // contribute $0 rather than being guessed at.
  const estimatedProfitYtd = salesQuotes
    .filter((quote) => quote.status === "closed_won" && quote.closedAt && new Date(quote.closedAt).getFullYear() === currentYear)
    .reduce((quoteSum, quote) => {
      const quoteProfit = quote.bomLines.reduce((lineSum, line) => {
        const catalogItem = line.catalogItemId ? catalogItemById.get(line.catalogItemId) : undefined;
        if (!catalogItem) {
          return lineSum;
        }
        const profitPerUnit = catalogItem.unitCost * (catalogItem.markupPercent / 100);
        return lineSum + profitPerUnit * line.qty;
      }, 0);
      return quoteSum + quoteProfit;
    }, 0);

  // Win Rate and Average Deal Size -- standard sales KPIs alongside pipeline
  // counts and profit. Win Rate is all-time (won / decided), not YTD-boxed,
  // since it's a conversion-efficiency signal that's noisy over a single
  // year for a team this size. (ARR/MRR, CAC, and quota attainment aren't
  // included -- this is project-based hardware sales with no recurring
  // billing, ad spend, or per-rep quota tracked anywhere in the app, so
  // there's no real data to compute them from rather than guess.)
  const closedWonQuotes = salesQuotes.filter((quote) => quote.status === "closed_won");
  const closedLostQuotes = salesQuotes.filter((quote) => quote.status === "closed_lost");
  const decidedQuoteCount = closedWonQuotes.length + closedLostQuotes.length;
  const winRatePercent = decidedQuoteCount > 0 ? Math.round((closedWonQuotes.length / decidedQuoteCount) * 100) : null;
  const quoteSellValue = (quote: SalesQuote) =>
    quote.bomLines.reduce((sum, line) => {
      const catalogItem = line.catalogItemId ? catalogItemById.get(line.catalogItemId) : undefined;
      return catalogItem ? sum + computeCatalogSellPrice(catalogItem, inventoryItems) * line.qty : sum;
    }, 0);
  const avgDealSize =
    closedWonQuotes.length > 0 ? closedWonQuotes.reduce((sum, quote) => sum + quoteSellValue(quote), 0) / closedWonQuotes.length : 0;

  return (
    <div className="content-grid">
      <section className="metric-grid">
        <Metric icon={<ClipboardList size={20} />} label="Quotes" value={String(salesQuotes.length)} />
        <Metric icon={<FolderOpen size={20} />} label="Open" value={String(openQuoteCount)} />
        <Metric icon={<ListChecks size={20} />} label="Closed This Year" value={String(closedThisYearQuotes.length)} />
        <Metric icon={<Award size={20} />} label="Win Rate" value={winRatePercent === null ? "--" : `${winRatePercent}%`} />
        <Metric icon={<DollarSign size={20} />} label="Avg Deal Size" value={money(avgDealSize)} />
        <Metric icon={<DollarSign size={20} />} label="Est. Profit (YTD)" value={money(estimatedProfitYtd)} />
      </section>

      <TaskMiniPanel
        title="Sales Tasks"
        tasks={combinedSalesTasks}
        taskActivity={taskActivity}
        teamMembers={teamMembers}
        projectSites={projectSites}
        isInternal
        hideAdd
        onCreate={onCreateTask}
        onUpdate={onUpdateTask}
        onDelete={onDeleteTask}
        onOpenFull={onOpenTasksView}
      />

      <SalesCatalog
        catalogItems={catalogItems}
        status={catalogStatus}
        isConfigured={isConfigured}
        canManage={canManageCatalog}
        onCreate={onCreateCatalogItem}
        onUpdate={onUpdateCatalogItem}
        onSetRetired={onSetCatalogItemRetired}
        onBulkImport={onBulkImportCatalogItems}
        onRefresh={onRefreshCatalog}
        onUploadDatasheet={onUploadCatalogDatasheet}
        inventoryItems={inventoryItems}
        currentUserEmail={currentUserEmail}
        priceChangeRequests={priceChangeRequests}
        priceChangeStatus={priceChangeStatus}
        onProposePriceChange={onProposePriceChange}
        projectSites={projectSites}
        teamMembers={teamMembers}
        onCreateTask={onCreateTask}
      />

      <SalesQuoteBuilder
        salesQuotes={salesQuotes}
        status={salesQuoteStatus}
        isConfigured={isConfigured}
        onCreateQuote={onCreateSalesQuote}
        onAddLocation={onAddSalesQuoteLocation}
        onUpdateLocation={onUpdateSalesQuoteLocation}
        onDeleteLocation={onDeleteSalesQuoteLocation}
        onAddLocationItem={onAddSalesQuoteLocationItem}
        onUpdateLocationItem={onUpdateSalesQuoteLocationItem}
        onDeleteLocationItem={onDeleteSalesQuoteLocationItem}
        onPullLocationHardware={onPullLocationHardwareIntoQuoteBom}
        onUpdateStatus={onUpdateSalesQuoteStatus}
        onDeleteQuote={onDeleteSalesQuote}
        onCreateProjectFromClosedWonQuote={onCreateProjectFromClosedWonQuote}
        onAddBomLines={onAddSalesQuoteBomLines}
        onDeleteBomLine={onDeleteSalesQuoteBomLine}
        onUpdateBomLineCatalogLink={onUpdateSalesQuoteBomLineCatalogLink}
        onUpdateProposalFields={onUpdateSalesQuoteProposalFields}
        onUpdateQuoteInfo={onUpdateSalesQuoteInfo}
        siteIntakeSchema={siteIntakeSchema}
        quoteIntakeResponses={quoteIntakeResponses}
        quoteIntakeStatus={quoteIntakeStatus}
        onLoadQuoteIntakeResponse={onLoadSalesQuoteIntakeResponse}
        onSaveQuoteIntakeResponses={onSaveSalesQuoteIntakeResponses}
        quoteProposals={quoteProposals}
        quoteProposalStatus={quoteProposalStatus}
        onLoadQuoteProposals={onLoadQuoteProposals}
        onCreateQuoteProposal={onCreateQuoteProposal}
        presalesRules={presalesRules}
        presalesStatus={presalesStatus}
        onGenerateBaselineBom={onGenerateBaselineBomForQuote}
        catalogItems={catalogItems}
        onUploadImage={onUploadSalesQuoteImage}
        onUpdateImageDescription={onUpdateSalesQuoteImageDescription}
        onDownloadImage={onDownloadSalesQuoteImage}
        onDeleteImage={onDeleteSalesQuoteImage}
        onGetImageUrl={onGetSalesQuoteImageUrl}
        onUpdateImageMeta={onUpdateSalesQuoteImageMeta}
        onMoveImage={onMoveSalesQuoteImage}
        siteHardwareRules={siteHardwareRules}
        projectSites={projectSites}
        tasks={tasks}
        teamMembers={teamMembers}
        onCreateTask={onCreateTask}
      />
    </div>
  );
}

// Matches a catalog item's Linked SKU / equipment field against Inventory --
// tries an exact ref (SKU) match first, then falls back to an exact name
// match, since the field is free text ("SKU-1234" or "VPU Server Recipe").
function findLinkedInventoryPart(item: CatalogItem, inventoryItems: Part[]): Part | undefined {
  const reference = item.linkedReference.trim().toLowerCase();
  if (!reference) {
    return undefined;
  }
  return (
    inventoryItems.find((part) => part.ref.toLowerCase() === reference) ??
    inventoryItems.find((part) => part.name.toLowerCase() === reference)
  );
}

// The unit cost actually used for pricing math. For costSource
// "inventory_unit_cost" this is resolved LIVE from the linked inventory
// item's current cost (which itself updates the moment a receipt changes
// it, see receiveInventoryStock) -- never the stale stored unitCost field.
// Manual/vendor-quote items just use the stored value.
function resolveCatalogUnitCost(item: CatalogItem, inventoryItems: Part[]): number {
  if (item.costSource === "inventory_unit_cost") {
    const part = findLinkedInventoryPart(item, inventoryItems);
    if (part) {
      return part.cost;
    }
  }
  return item.unitCost;
}

// Live current sell price = unit cost x (1 + markup%). Falls back to the
// stored defaultSellPrice for items with no cost/markup set up yet (e.g.
// legacy flat-priced catalog rows imported before this pricing model
// existed), so nothing goes to $0 just because it hasn't been re-priced.
function computeCatalogSellPrice(item: CatalogItem, inventoryItems: Part[]): number {
  const unitCost = resolveCatalogUnitCost(item, inventoryItems);
  if (unitCost > 0) {
    return unitCost * (1 + item.markupPercent / 100);
  }
  return item.defaultSellPrice;
}

// Fixed category list per E, in display order. "Uncategorized" is a
// catch-all appended at the end -- not one of E's real categories -- used
// as the safe default for new items and for the 304 items imported from
// the PandaDoc export whose original category strings didn't fit any of
// these (see migration 051).
const CATALOG_CATEGORY_OPTIONS = [
  "VPUs",
  "Cameras",
  "Signage",
  "Camera Accessories",
  "Sign Accessories",
  "Network/Coms.",
  "EnSight Kits",
  "Power",
  "Lighting",
  // Added for the Site Builder location "Space Sensor" section (E asked
  // sensors to have a real Category, not just a tag) -- not part of E's
  // original 9-category list, flagging that this is a new addition.
  "Space Sensors",
  "Uncategorized",
];

const EMPTY_CATALOG_DRAFT = {
  catalogNumber: "",
  productName: "",
  salesDescription: "",
  technicalDescription: "",
  category: "Uncategorized",
  manufacturer: "",
  defaultSellPrice: 0,
  costSource: "manual" as CatalogItem["costSource"],
  linkedReference: "",
  datasheetUrl: "",
  imageUrl: "",
  isRetired: false,
  unitCost: 0,
  markupPercent: 0,
  itemType: "regular" as CatalogItem["itemType"],
  billingFrequency: "",
  bundleComponents: "",
  heightIn: "",
  widthIn: "",
  pixelPitchMm: "",
  builtinFlasherModule: "",
  additionalSpaceMultiplier: null as number | null,
  insertQuantity: null as number | null,
  tags: [] as string[],
  specifications: {} as Record<string, string>,
  datasheetStoragePath: "",
};

// Category-specific "Details" fields for the Add/Edit Product modal.
// Signage is deliberately excluded here -- it keeps using the existing
// typed columns (heightIn/widthIn/pixelPitchMm/etc.) added for the
// PandaDoc import gap-fill (migration 046). Everything else stores its
// details in the flexible `specifications` bag (migration 052). E asked
// for "a few specifications for each one" as filler/starting points --
// these are best-guess placeholders meant to be refined once E gives
// exact field lists per category, not a final spec.
const CATALOG_CATEGORY_FIELDS: Record<string, Array<{ key: string; label: string; placeholder?: string }>> = {
  VPUs: [
    { key: "dimensions", label: "Dimensions (H x W x D)", placeholder: `e.g. 17" x 12" x 4"` },
    { key: "powerDraw", label: "Power Draw (W)", placeholder: "e.g. 65" },
    { key: "operatingTemp", label: "Operating Temp Range", placeholder: "e.g. -20C to 50C" },
    { key: "portsInputs", label: "Ports / Inputs", placeholder: "e.g. 4x PoE, HDMI, USB-C" },
    { key: "mountingType", label: "Mounting Type", placeholder: "e.g. Rack, DIN rail, wall" },
  ],
  Cameras: [
    { key: "resolution", label: "Resolution", placeholder: "e.g. 4K / 8MP" },
    { key: "fieldOfView", label: "Field of View", placeholder: "e.g. 110 degrees" },
    { key: "lensType", label: "Lens Type", placeholder: "e.g. Fixed, varifocal" },
    { key: "ipRating", label: "IP Rating", placeholder: "e.g. IP66" },
    { key: "dimensions", label: "Dimensions (H x W x D)" },
  ],
  "Camera Accessories": [
    { key: "compatibleModels", label: "Compatible Camera Models" },
    { key: "mountType", label: "Mount Type", placeholder: "e.g. Pole, wall, ceiling" },
    { key: "material", label: "Material", placeholder: "e.g. Aluminum, polycarbonate" },
  ],
  "Sign Accessories": [
    { key: "compatibleModels", label: "Compatible Sign Models" },
    { key: "material", label: "Material" },
    { key: "dimensions", label: "Dimensions" },
  ],
  "Network/Coms.": [
    { key: "bandwidth", label: "Bandwidth", placeholder: "e.g. 1 Gbps" },
    { key: "connectorType", label: "Connector Type", placeholder: "e.g. RJ45, SFP+" },
    { key: "range", label: "Range", placeholder: "e.g. 300ft" },
    { key: "protocol", label: "Protocol", placeholder: "e.g. LTE, Wi-Fi 6, PoE+" },
  ],
  "EnSight Kits": [
    { key: "kitContents", label: "Kit Contents" },
    { key: "itemsIncluded", label: "Number of Items Included" },
    { key: "useCase", label: "Use Case" },
  ],
  Power: [
    { key: "wattage", label: "Wattage" },
    { key: "voltage", label: "Voltage" },
    { key: "batteryCapacity", label: "Battery Capacity (if applicable)" },
  ],
  Lighting: [
    { key: "lumens", label: "Lumens" },
    { key: "colorTemperature", label: "Color Temperature", placeholder: "e.g. 5000K" },
    { key: "beamAngle", label: "Beam Angle" },
  ],
};

function SalesCatalog({
  catalogItems,
  status,
  isConfigured,
  canManage,
  onCreate,
  onUpdate,
  onSetRetired,
  onBulkImport,
  onRefresh,
  onUploadDatasheet,
  inventoryItems,
  currentUserEmail,
  priceChangeRequests,
  priceChangeStatus,
  onProposePriceChange,
  projectSites,
  teamMembers,
  onCreateTask,
}: {
  catalogItems: CatalogItem[];
  status: string;
  isConfigured: boolean;
  canManage: boolean;
  onCreate: (item: Omit<CatalogItem, "id" | "catalogNumber">) => void;
  onUpdate: (id: string, item: Omit<CatalogItem, "id">) => void;
  onSetRetired: (id: string, retired: boolean) => void;
  onBulkImport: (items: Array<Omit<CatalogItem, "id" | "catalogNumber">>) => Promise<number>;
  onRefresh: () => void;
  onUploadDatasheet: (catalogItemId: string, file: File) => Promise<string | null>;
  inventoryItems: Part[];
  currentUserEmail: string;
  priceChangeRequests: CatalogPriceChangeRequest[];
  priceChangeStatus: string;
  onProposePriceChange: (catalogItemId: string, fieldChanged: CatalogPriceChangeField, previousValue: number, requestedValue: number, reason: string) => void;
  projectSites: ProjectSite[];
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">) => Promise<boolean>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_CATALOG_DRAFT);
  const [previewItem, setPreviewItem] = useState<CatalogItem | null>(null);
  const [filters, setFilters] = useState({ search: "", category: "All", manufacturer: "", status: "All" });
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<Array<Omit<CatalogItem, "id" | "catalogNumber">>>([]);
  const [importStatus, setImportStatus] = useState("");
  const [importStatusIsError, setImportStatusIsError] = useState(false);
  const [isCommittingImport, setIsCommittingImport] = useState(false);
  const [isCollapsed, setIsCollapsed] = usePersistedCollapse("product_catalog");
  const [proposalItem, setProposalItem] = useState<CatalogItem | null>(null);
  const [proposalField, setProposalField] = useState<CatalogPriceChangeField>("markup_percent");
  const [proposalValue, setProposalValue] = useState(0);
  const [proposalReason, setProposalReason] = useState("");
  const [isUploadingDatasheet, setIsUploadingDatasheet] = useState(false);

  const visibleItems = catalogItems.filter((item) => {
    const status = item.isRetired ? "Retired" : "Active";
    return (
      `${item.productName} ${(item.tags ?? []).join(" ")}`.toLowerCase().includes(filters.search.toLowerCase()) &&
      (filters.category === "All" || item.category === filters.category) &&
      item.manufacturer.toLowerCase().includes(filters.manufacturer.toLowerCase()) &&
      (filters.status === "All" || status === filters.status)
    );
  });
  const myPendingRequests = priceChangeRequests.filter((request) => request.status === "pending" && request.requestedByEmail.toLowerCase() === currentUserEmail.toLowerCase());

  function openAddModal() {
    setEditingId(null);
    setDraft(EMPTY_CATALOG_DRAFT);
    setModalOpen(true);
  }

  function openEditModal(item: CatalogItem) {
    setEditingId(item.id);
    setDraft({
      catalogNumber: item.catalogNumber,
      productName: item.productName,
      salesDescription: item.salesDescription,
      technicalDescription: item.technicalDescription,
      category: item.category,
      manufacturer: item.manufacturer,
      defaultSellPrice: item.defaultSellPrice,
      costSource: item.costSource,
      linkedReference: item.linkedReference,
      datasheetUrl: item.datasheetUrl,
      imageUrl: item.imageUrl,
      isRetired: item.isRetired,
      unitCost: item.unitCost,
      markupPercent: item.markupPercent,
      itemType: item.itemType,
      billingFrequency: item.billingFrequency,
      bundleComponents: item.bundleComponents,
      heightIn: item.heightIn,
      widthIn: item.widthIn,
      pixelPitchMm: item.pixelPitchMm,
      builtinFlasherModule: item.builtinFlasherModule,
      additionalSpaceMultiplier: item.additionalSpaceMultiplier,
      insertQuantity: item.insertQuantity,
      tags: [...(item.tags ?? [])],
      specifications: { ...(item.specifications ?? {}) },
      datasheetStoragePath: item.datasheetStoragePath ?? "",
    });
    setModalOpen(true);
  }

  async function handleDatasheetFileSelect(file: File | undefined) {
    if (!file || !editingId) {
      return;
    }
    setIsUploadingDatasheet(true);
    const storagePath = await onUploadDatasheet(editingId, file);
    if (storagePath) {
      setDraft((current) => ({ ...current, datasheetStoragePath: storagePath }));
    }
    setIsUploadingDatasheet(false);
  }

  function uploadCatalogImage(file: File | undefined) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDraft((current) => ({ ...current, imageUrl: String(reader.result ?? "") }));
    };
    reader.readAsDataURL(file);
  }

  function submitDraft() {
    if (!draft.productName.trim()) {
      return;
    }
    const cleaned = { ...draft, tags: [...new Set((draft.tags ?? []).map((tag) => tag.trim()).filter(Boolean))] };
    if (editingId) {
      onUpdate(editingId, cleaned);
    } else {
      onCreate(cleaned);
    }
    setModalOpen(false);
  }

  // Sales reps have no direct write access to the catalog (Admin/Manager
  // only) -- this opens a small modal that submits a
  // catalog_price_change_requests row instead of PATCHing the item, so the
  // change only takes effect once a manager approves it.
  function openProposalModal(item: CatalogItem, field: CatalogPriceChangeField) {
    setProposalItem(item);
    setProposalField(field);
    setProposalValue(field === "unit_cost" ? item.unitCost : field === "markup_percent" ? item.markupPercent : item.defaultSellPrice);
    setProposalReason("");
  }

  function submitProposal() {
    if (!proposalItem) {
      return;
    }
    const previousValue = proposalField === "unit_cost" ? proposalItem.unitCost : proposalField === "markup_percent" ? proposalItem.markupPercent : proposalItem.defaultSellPrice;
    onProposePriceChange(proposalItem.id, proposalField, previousValue, proposalValue, proposalReason);
    setProposalItem(null);
  }

  function openImportModal() {
    setImportRows([]);
    setImportStatus("");
    setImportModalOpen(true);
  }

  // Bulk catalog import: same in-browser, parse-then-preview-then-commit
  // pattern as the Phase 19 BOM spreadsheet import (see handleBomFileSelect
  // above) -- SheetJS reads the file client-side, header names are matched
  // loosely (case/spacing-insensitive), nothing is written until commit.
  async function handleCatalogFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setImportStatus("Parsing...");
    setImportStatusIsError(false);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed = rawRows
        .map((row) => {
          const keys = Object.keys(row);
          const findKey = (...candidates: string[]) => keys.find((key) => candidates.includes(key.trim().toLowerCase()));
          const asText = (key: string | undefined) => (key ? String(row[key]).trim() : "");
          const productName = asText(findKey("product name", "product", "name", "item"));
          // The source file's Category column is free text (often a whole
          // nested path like "EnSight Signage/Signal Tech/Standard
          // Catalog/..."), not one of the fixed CATALOG_CATEGORY_OPTIONS --
          // rather than guess a mapping, every import lands in
          // "Uncategorized" and the original text is preserved as a tag so
          // nothing is lost and it's still searchable/filterable.
          const rawCategory = asText(findKey("category"));
          const manufacturer = asText(findKey("manufacturer", "brand", "vendor"));
          const priceKey = findKey("default sell price", "sell price", "price");
          const defaultSellPrice = priceKey ? Number(row[priceKey]) || 0 : 0;
          const costKey = findKey("unit cost", "cost");
          const unitCost = costKey ? Number(row[costKey]) || 0 : 0;
          const linkedReference = asText(findKey("linked reference", "linked sku", "sku", "equipment"));
          const datasheetUrl = asText(findKey("datasheet url", "datasheet", "datasheet link"));
          const imageUrl = asText(findKey("image url", "image", "image link", "images"));
          const salesDescription = asText(findKey("sales description", "description"));
          const technicalDescription = asText(findKey("technical description", "specs", "technical notes"));
          // Gaps filled in from E's PandaDoc export (flat_priced_products.csv):
          // bundle/subscription metadata and signage physical specs.
          const itemType: CatalogItem["itemType"] = asText(findKey("type", "item type")).toLowerCase() === "bundle" ? "bundle" : "regular";
          const billingFrequency = asText(findKey("billing_frequency", "billing frequency"));
          const bundleComponents = asText(findKey("skus_in_bundle", "skus in bundle", "bundle components"));
          const heightIn = asText(findKey("height", "height_in", "height (in)"));
          const widthIn = asText(findKey("width", "width_in", "width (in)"));
          const pixelPitchMm = asText(findKey("pixel pitch", "pixel_pitch", "pixel pitch mm"));
          const builtinFlasherModule = asText(findKey("builtin flasher module", "built-in flasher module", "flasher module"));
          const additionalSpaceMultiplierKey = findKey("multiplier for additional spaces.", "multiplier for additional spaces", "additional space multiplier");
          const additionalSpaceMultiplier = additionalSpaceMultiplierKey && String(row[additionalSpaceMultiplierKey]).trim() !== "" ? Number(row[additionalSpaceMultiplierKey]) || 0 : null;
          const insertQuantityKey = findKey("insert quantity", "insert_quantity");
          const insertQuantity = insertQuantityKey && String(row[insertQuantityKey]).trim() !== "" ? Number(row[insertQuantityKey]) || 0 : null;
          const item: Omit<CatalogItem, "id" | "catalogNumber"> = {
            productName,
            category: "Uncategorized",
            tags: rawCategory ? [rawCategory] : [],
            manufacturer,
            defaultSellPrice,
            costSource: "manual",
            unitCost,
            markupPercent: 0,
            linkedReference,
            datasheetUrl,
            imageUrl,
            salesDescription,
            technicalDescription,
            isRetired: false,
            itemType,
            billingFrequency,
            bundleComponents,
            heightIn,
            widthIn,
            pixelPitchMm,
            builtinFlasherModule,
            additionalSpaceMultiplier,
            insertQuantity,
            specifications: {},
            datasheetStoragePath: "",
          };
          return item;
        })
        .filter((row) => row.productName);
      setImportRows(parsed);
      setImportStatus(
        parsed.length
          ? `Parsed ${parsed.length} row(s) -- review below, then commit.`
          : "No recognizable rows found -- check column headers (Product Name is required).",
      );
      setImportStatusIsError(parsed.length === 0);
    } catch (error) {
      setImportStatus("Could not parse that file. Make sure it's a valid .xlsx or .csv.");
      setImportStatusIsError(true);
    }
  }

  async function commitImport() {
    if (importRows.length === 0) {
      return;
    }
    setIsCommittingImport(true);
    try {
      const count = await onBulkImport(importRows);
      setImportStatus(`Added ${count} item(s) to the catalog.`);
      setImportStatusIsError(false);
      setImportRows([]);
    } catch (error) {
      setImportStatus(
        `Import failed -- nothing was added to the catalog. ${error instanceof Error ? error.message : "Could not import catalog items."}`,
      );
      setImportStatusIsError(true);
    } finally {
      setIsCommittingImport(false);
    }
  }

  return (
    <>
      <section className="panel wide">
        <PanelHeader
          title="Product Catalog"
          label="Reference info: datasheets and actively sold products"
          collapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed((current) => !current)}
        />
        {!isCollapsed && (
          <>
            <div className="report-filter-row">
              {canManage && (
                <button className="primary-action mini-action" type="button" onClick={openAddModal} disabled={!isConfigured}>
                  <Plus size={14} /> Add Product
                </button>
              )}
              {canManage && (
                <button className="secondary-action mini-action" type="button" onClick={openImportModal} disabled={!isConfigured}>
                  <Upload size={14} /> Upload list
                </button>
              )}
              <RequestTaskButton section="sales_catalog" teamMembers={teamMembers} projectSites={projectSites} onCreate={onCreateTask} />
              <button className="secondary-action mini-action" type="button" onClick={onRefresh}>Refresh</button>
              {!isConfigured && <span className="muted">Set Supabase env vars to manage the catalog.</span>}
              {!canManage && <span className="muted">Only Admins and Managers can add, edit, or retire catalog items -- propose a price change instead.</span>}
              {status && <span className="muted">{status}</span>}
              {priceChangeStatus && <span className="muted">{priceChangeStatus}</span>}
            </div>
            {myPendingRequests.length > 0 && (
              <p className="muted">You have {myPendingRequests.length} price change request(s) awaiting manager approval.</p>
            )}
            <div className="catalog-table-scroll">
            <table className="tight-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Catalog #</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Manufacturer</th>
                  <th>Unit Cost</th>
                  <th>Markup %</th>
                  <th>Sell Price</th>
                  <th>Linked Ref</th>
                  <th>Status</th>
                </tr>
                <tr className="filter-row">
                  <th></th>
                  <th></th>
                  <th><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Filter product/tag" /></th>
                  <th>
                    <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}>
                      <option>All</option>
                      {CATALOG_CATEGORY_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  </th>
                  <th><input value={filters.manufacturer} onChange={(event) => setFilters((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Filter vendor" /></th>
                  <th></th>
                  <th></th>
                  <th></th>
                  <th></th>
                  <th>
                    <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                      <option>All</option>
                      <option>Active</option>
                      <option>Retired</option>
                    </select>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const liveUnitCost = resolveCatalogUnitCost(item, inventoryItems);
                  const linkedInventoryPart = findLinkedInventoryPart(item, inventoryItems);
                  const isLiveInventoryLinked = item.costSource === "inventory_unit_cost" && Boolean(linkedInventoryPart);
                  const computedSellPrice = computeCatalogSellPrice(item, inventoryItems);
                  return (
                    <tr
                      key={item.id}
                      className={`clickable-row${item.isRetired ? " muted-row" : ""}`}
                      onClick={() => (canManage ? openEditModal(item) : !item.isRetired && openProposalModal(item, "markup_percent"))}
                    >
                      <td onClick={(event) => event.stopPropagation()}>
                        <button className="thumbnail-button" type="button" onClick={() => setPreviewItem(item)} aria-label={`Open image for ${item.productName}`}>
                          {item.imageUrl || linkedInventoryPart?.imageUrl ? <img src={item.imageUrl || linkedInventoryPart?.imageUrl} alt="" /> : <Image size={18} />}
                        </button>
                      </td>
                      <td>{item.catalogNumber}</td>
                      <td>
                        {item.productName}
                        {(item.tags ?? []).length > 0 && <div className="tag-chip-row">{(item.tags ?? []).map((tag) => <span key={tag}>{tag}</span>)}</div>}
                      </td>
                      <td>{item.category}</td>
                      <td>{item.manufacturer}</td>
                      <td>{money(liveUnitCost)}{isLiveInventoryLinked && <small className="muted"> (live)</small>}</td>
                      <td>{item.markupPercent}%</td>
                      <td>{money(computedSellPrice)}</td>
                      <td>
                        {item.linkedReference}
                        {linkedInventoryPart && (
                          <div>
                            <small className="muted" title={`Cross-referenced with Inventory item ${linkedInventoryPart.ref}`}>
                              &#x2713; Linked to Inventory
                            </small>
                          </div>
                        )}
                      </td>
                      <td>{item.isRetired ? "Retired" : "Active"}</td>
                    </tr>
                  );
                })}
                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan={10} className="empty-compact-state">
                      No catalog items yet. Add a product to start building the sales catalog.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>

            {/* Mobile-only: the table above requires horizontal scroll to
                reach Category/Price/Status, which E flagged as unusable on
                a phone -- this is a stacked-card equivalent of the same
                visibleItems list, filters included, shown instead of the
                table under 760px (see .catalog-mobile-list / .catalog-table-scroll
                in styles.css). */}
            <div className="catalog-mobile-list">
              <div className="catalog-mobile-filters">
                <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search product/tag" />
                <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}>
                  <option>All</option>
                  {CATALOG_CATEGORY_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                </select>
                <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                  <option>All</option>
                  <option>Active</option>
                  <option>Retired</option>
                </select>
              </div>
              {visibleItems.map((item) => {
                const liveUnitCost = resolveCatalogUnitCost(item, inventoryItems);
                const linkedInventoryPart = findLinkedInventoryPart(item, inventoryItems);
                const isLiveInventoryLinked = item.costSource === "inventory_unit_cost" && Boolean(linkedInventoryPart);
                const computedSellPrice = computeCatalogSellPrice(item, inventoryItems);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`catalog-mobile-card${item.isRetired ? " muted-row" : ""}`}
                    onClick={() => (canManage ? openEditModal(item) : !item.isRetired && openProposalModal(item, "markup_percent"))}
                  >
                    <span
                      className="thumbnail-button"
                      role="img"
                      aria-label={`Image for ${item.productName}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPreviewItem(item);
                      }}
                    >
                      {item.imageUrl || linkedInventoryPart?.imageUrl ? <img src={item.imageUrl || linkedInventoryPart?.imageUrl} alt="" /> : <Image size={18} />}
                    </span>
                    <span className="catalog-mobile-card-body">
                      <span className="catalog-mobile-card-title-row">
                        <strong>{item.productName}</strong>
                        <span className={`status ${item.isRetired ? "" : "ok"}`}>{item.isRetired ? "Retired" : "Active"}</span>
                      </span>
                      <span className="catalog-mobile-card-meta">{item.catalogNumber} &middot; {item.category} &middot; {item.manufacturer}</span>
                      {(item.tags ?? []).length > 0 && <span className="tag-chip-row">{(item.tags ?? []).map((tag) => <span key={tag}>{tag}</span>)}</span>}
                      <span className="catalog-mobile-card-price-row">
                        <strong>{money(computedSellPrice)}</strong>
                        <small className="muted">{money(liveUnitCost)} cost{isLiveInventoryLinked && " (live)"}</small>
                      </span>
                      {linkedInventoryPart && (
                        <small className="muted" title={`Cross-referenced with Inventory item ${linkedInventoryPart.ref}`}>
                          &#x2713; Linked to Inventory
                        </small>
                      )}
                    </span>
                  </button>
                );
              })}
              {visibleItems.length === 0 && (
                <div className="empty-compact-state">No catalog items yet. Add a product to start building the sales catalog.</div>
              )}
            </div>
          </>
        )}
      </section>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="catalog-item-title">
            <div className="modal-header">
              <div>
                <h2 id="catalog-item-title">{editingId ? "Edit Product" : "Add Product"}</h2>
                <p>Sales-facing product details for quotes and the catalog list.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setModalOpen(false)} aria-label="Close product editor">x</button>
            </div>
            <div className="inventory-editor-hero">
              <label className="item-image-upload">
                {draft.imageUrl ? <img src={draft.imageUrl} alt={`${draft.productName || "Product"} preview`} /> : <><Image size={28} /><span>Upload Image</span></>}
                <input type="file" accept="image/*" onChange={(event) => uploadCatalogImage(event.target.files?.[0])} />
              </label>
              <div className="item-identity-fields">
                <label>Product name<input value={draft.productName} onChange={(event) => setDraft((current) => ({ ...current, productName: event.target.value }))} placeholder="Product name" /></label>
                <label>Image URL (or upload above)<input value={draft.imageUrl} onChange={(event) => setDraft((current) => ({ ...current, imageUrl: event.target.value }))} placeholder="Paste a direct image link instead" /></label>
              </div>
            </div>
            <div className="bom-modal-grid">
              <label>Category<select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}>
                {CATALOG_CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select></label>
              <label>Manufacturer<input value={draft.manufacturer} onChange={(event) => setDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Manufacturer" /></label>
              <label className="span-2">
                Tags (comma-separated)
                <input
                  value={draft.tags.join(", ")}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      tags: event.target.value.split(",").map((tag) => tag.trimStart()),
                    }))
                  }
                  placeholder="e.g. Featured, Discontinued Soon"
                />
              </label>
              <label>Cost source<select value={draft.costSource} onChange={(event) => setDraft((current) => ({ ...current, costSource: event.target.value as CatalogItem["costSource"] }))}>
                <option value="manual">Manual</option>
                <option value="inventory_unit_cost">Inventory unit cost (live)</option>
                <option value="vendor_quote">Vendor quote</option>
              </select></label>
              <label className="span-2">
                Linked SKU / equipment
                <input value={draft.linkedReference} onChange={(event) => setDraft((current) => ({ ...current, linkedReference: event.target.value }))} placeholder="e.g. SKU-1234 or VPU Server Recipe" />
              </label>
              {draft.linkedReference.trim() && (
                <div className="span-2 muted">
                  {findLinkedInventoryPart(draft as CatalogItem, inventoryItems)
                    ? `Cross-referenced with Inventory: ${findLinkedInventoryPart(draft as CatalogItem, inventoryItems)?.name} (${findLinkedInventoryPart(draft as CatalogItem, inventoryItems)?.ref}).`
                    : "No exact match in Inventory for that SKU/name yet."}
                </div>
              )}
              <label>
                {draft.costSource === "inventory_unit_cost" ? "Fallback unit cost (used if no inventory match)" : "Unit cost"}
                <input type="number" min={0} step="0.01" value={draft.unitCost} onChange={(event) => setDraft((current) => ({ ...current, unitCost: Number(event.target.value) }))} />
              </label>
              <label>Markup %<input type="number" step="0.1" value={draft.markupPercent} onChange={(event) => setDraft((current) => ({ ...current, markupPercent: Number(event.target.value) }))} /></label>
              <label>Default sell price (fallback if no cost set)<input type="number" min={0} step="0.01" value={draft.defaultSellPrice} onChange={(event) => setDraft((current) => ({ ...current, defaultSellPrice: Number(event.target.value) }))} /></label>
              <div className="span-2 muted">
                Live suggested price: <strong>{money(computeCatalogSellPrice(draft as CatalogItem, inventoryItems))}</strong>
                {draft.costSource === "inventory_unit_cost" && !findLinkedInventoryPart(draft as CatalogItem, inventoryItems) && " -- no inventory match found for that Linked SKU yet, using fallback unit cost."}
              </div>
              <label className="span-2">Sales description<textarea value={draft.salesDescription} onChange={(event) => setDraft((current) => ({ ...current, salesDescription: event.target.value }))} placeholder="Customer-facing description for quotes" /></label>
              <label className="span-2">Technical description<textarea value={draft.technicalDescription} onChange={(event) => setDraft((current) => ({ ...current, technicalDescription: event.target.value }))} placeholder="Specs, dimensions, technical notes" /></label>
              <label>Datasheet URL (external link)<input value={draft.datasheetUrl} onChange={(event) => setDraft((current) => ({ ...current, datasheetUrl: event.target.value }))} placeholder="Link to a datasheet" /></label>
              <div className="field-group">
                <span>Datasheet file</span>
                {editingId ? (
                  <div className="datasheet-upload-row">
                    <label className="secondary-action mini-action hidden-file-label">
                      <Upload size={14} /> {isUploadingDatasheet ? "Uploading..." : draft.datasheetStoragePath ? "Replace PDF" : "Upload PDF"}
                      <input type="file" accept=".pdf" disabled={isUploadingDatasheet} onChange={(event) => handleDatasheetFileSelect(event.target.files?.[0])} />
                    </label>
                    {draft.datasheetStoragePath && (
                      <a href={getCatalogDatasheetPublicUrl(draft.datasheetStoragePath) ?? "#"} target="_blank" rel="noreferrer">
                        View uploaded PDF
                      </a>
                    )}
                  </div>
                ) : (
                  <span className="muted">Save the product first, then come back to Edit to upload a datasheet PDF.</span>
                )}
              </div>
              <label>Item type<select value={draft.itemType} onChange={(event) => setDraft((current) => ({ ...current, itemType: event.target.value as CatalogItem["itemType"] }))}>
                <option value="regular">Regular</option>
                <option value="bundle">Bundle</option>
              </select></label>
              {draft.itemType === "bundle" && (
                <label className="span-2">Bundle components<input value={draft.bundleComponents} onChange={(event) => setDraft((current) => ({ ...current, bundleComponents: event.target.value }))} placeholder="SKU:qty, SKU:qty" /></label>
              )}
            </div>
            <div className="compact-edit-section">
              <div className="compact-section-header">
                <div>
                  <h3>Details</h3>
                  <p>
                    {draft.category === "Signage"
                      ? "Physical specs for digital signage."
                      : CATALOG_CATEGORY_FIELDS[draft.category]
                        ? `Specs for ${draft.category}. Starter fields -- tell me the exact ones you want and I'll adjust.`
                        : "No details fields set up yet for this category."}
                  </p>
                </div>
              </div>
              {draft.category === "Signage" ? (
                <div className="bom-modal-grid">
                  <label>Billing frequency<input value={draft.billingFrequency} onChange={(event) => setDraft((current) => ({ ...current, billingFrequency: event.target.value }))} placeholder="e.g. one-time, monthly, annual" /></label>
                  <label>Height (in)<input value={draft.heightIn} onChange={(event) => setDraft((current) => ({ ...current, heightIn: event.target.value }))} placeholder="e.g. 48" /></label>
                  <label>Width (in)<input value={draft.widthIn} onChange={(event) => setDraft((current) => ({ ...current, widthIn: event.target.value }))} placeholder="e.g. 36" /></label>
                  <label>Pixel pitch (mm)<input value={draft.pixelPitchMm} onChange={(event) => setDraft((current) => ({ ...current, pixelPitchMm: event.target.value }))} placeholder="Digital signage only" /></label>
                  <label>Built-in flasher module<input value={draft.builtinFlasherModule} onChange={(event) => setDraft((current) => ({ ...current, builtinFlasherModule: event.target.value }))} /></label>
                  <label>Additional space multiplier<input type="number" step="0.01" value={draft.additionalSpaceMultiplier ?? ""} onChange={(event) => setDraft((current) => ({ ...current, additionalSpaceMultiplier: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
                  <label>Insert quantity<input type="number" step="1" value={draft.insertQuantity ?? ""} onChange={(event) => setDraft((current) => ({ ...current, insertQuantity: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
                </div>
              ) : CATALOG_CATEGORY_FIELDS[draft.category] ? (
                <div className="bom-modal-grid">
                  {CATALOG_CATEGORY_FIELDS[draft.category].map((field) => (
                    <label key={field.key}>
                      {field.label}
                      <input
                        value={draft.specifications[field.key] ?? ""}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            specifications: { ...current.specifications, [field.key]: event.target.value },
                          }))
                        }
                        placeholder={field.placeholder}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <p className="muted">Uncategorized items don't have a details template -- pick a real category above to see its fields.</p>
              )}
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setModalOpen(false)}>Cancel</button>
              {editingId && canManage && (
                <button className="secondary-action danger-action" type="button" onClick={() => onSetRetired(editingId, !draft.isRetired)}>
                  {draft.isRetired ? "Reactivate Product" : "Retire Product"}
                </button>
              )}
              <button className="primary-action" type="button" onClick={submitDraft} disabled={!draft.productName.trim()}>{editingId ? "Save Product" : "Add Product"}</button>
            </div>
          </section>
        </div>
      )}

      {importModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="catalog-import-title">
            <div className="modal-header">
              <div>
                <h2 id="catalog-import-title">Upload a list of items</h2>
                <p>Import a .xlsx or .csv with columns like Product Name, Category, Manufacturer, Sell Price, Linked Reference, Datasheet URL.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setImportModalOpen(false)} aria-label="Close catalog import">x</button>
            </div>
            <label className="hidden-file-label secondary-action mini-action">
              <Upload size={14} /> Choose file
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleCatalogFileSelect} />
            </label>
            {importStatus && (
              <small className={importStatusIsError ? "error-text" : "muted"}>{importStatus}</small>
            )}
            {importRows.length > 0 && (
              <>
                <p className="muted">Category will be set to "Uncategorized" for all rows -- sort them into your real categories afterward. The source file's category text is kept as a tag so nothing's lost.</p>
                <table className="stack-table-mobile">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Tags (from source category)</th>
                      <th>Manufacturer</th>
                      <th>Sell Price</th>
                      <th>Linked Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, index) => (
                      <tr key={index}>
                        <td data-label="Product">{row.productName}</td>
                        <td data-label="Tags (from source category)">{(row.tags ?? []).join(", ")}</td>
                        <td data-label="Manufacturer">{row.manufacturer}</td>
                        <td data-label="Sell Price">{money(row.defaultSellPrice)}</td>
                        <td data-label="Linked Ref">{row.linkedReference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="modal-actions">
                  <button className="secondary-action" type="button" onClick={() => { setImportRows([]); setImportStatus(""); }}>Discard</button>
                  <button className="primary-action" type="button" onClick={commitImport} disabled={isCommittingImport}>
                    {isCommittingImport ? "Importing..." : `Commit ${importRows.length} Item(s) to Catalog`}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {previewItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="catalog-image-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="catalog-image-modal-title">{previewItem.productName}</h2>
                <p>{previewItem.catalogNumber} -- {previewItem.manufacturer}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setPreviewItem(null)} aria-label="Close image preview">x</button>
            </div>
            <div className="large-image-preview">
              {previewItem.imageUrl || findLinkedInventoryPart(previewItem, inventoryItems)?.imageUrl ? (
                <img src={previewItem.imageUrl || findLinkedInventoryPart(previewItem, inventoryItems)?.imageUrl} alt={previewItem.productName} />
              ) : (
                <><Image size={42} /><span>No image added yet. Use Edit to upload an image.</span></>
              )}
            </div>
          </section>
        </div>
      )}

      {proposalItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="catalog-proposal-title">
            <div className="modal-header">
              <div>
                <h2 id="catalog-proposal-title">Propose a price change</h2>
                <p>
                  {proposalItem.productName} -- this goes to your manager for approval before it takes effect; it won't change the catalog on its own.
                </p>
              </div>
              <button className="icon-button" type="button" onClick={() => setProposalItem(null)} aria-label="Close price change proposal">x</button>
            </div>
            <div className="bom-modal-grid">
              <label>What are you changing?
                <select
                  value={proposalField}
                  onChange={(event) => {
                    const field = event.target.value as CatalogPriceChangeField;
                    setProposalField(field);
                    setProposalValue(field === "unit_cost" ? proposalItem.unitCost : field === "markup_percent" ? proposalItem.markupPercent : proposalItem.defaultSellPrice);
                  }}
                >
                  <option value="markup_percent">Markup %</option>
                  <option value="unit_cost">Unit cost</option>
                  <option value="default_sell_price">Sell price override</option>
                </select>
              </label>
              <label>
                Current value
                <input type="number" value={proposalField === "unit_cost" ? proposalItem.unitCost : proposalField === "markup_percent" ? proposalItem.markupPercent : proposalItem.defaultSellPrice} disabled readOnly />
              </label>
              <label>Requested value<input type="number" step="0.01" value={proposalValue} onChange={(event) => setProposalValue(Number(event.target.value))} /></label>
              <label className="span-2">Reason (for your manager)<textarea value={proposalReason} onChange={(event) => setProposalReason(event.target.value)} placeholder="e.g. customer requested a discount, vendor cost increase, etc." /></label>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setProposalItem(null)}>Cancel</button>
              <button className="primary-action" type="button" onClick={submitProposal}>Submit for approval</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

// v1 hardware recommendation engine for Site Builder (migration 045). Each
// active rule maps one metric collected on a location (FLI/LPR/People
// Counting checkboxes, or entry/exit/level counts) to a quantity of an
// item; this sums matching rules for one location (or, when called with an
// already-summed accumulator, across every location in a quote). These are
// v1 starter assumptions meant to be tuned from Admin -> Site Hardware
// Rules, not a validated hardware spec.
function accumulateLocationHardware(location: SalesQuoteLocation, rules: SiteHardwareRule[], into: Map<string, number>) {
  rules
    .filter((rule) => rule.isActive)
    .forEach((rule) => {
      let qty = 0;
      switch (rule.metric) {
        case "fli":
          qty = location.fli ? rule.qtyPerUnit : 0;
          break;
        case "lpr":
          qty = location.lpr ? rule.qtyPerUnit : 0;
          break;
        case "people_counting":
          qty = location.peopleCounting ? rule.qtyPerUnit : 0;
          break;
        case "per_entry":
          qty = location.entriesCount * rule.qtyPerUnit;
          break;
        case "per_exit":
          qty = location.exitsCount * rule.qtyPerUnit;
          break;
        case "per_level":
          qty = location.levelsCount * rule.qtyPerUnit;
          break;
      }
      if (qty > 0) {
        into.set(rule.itemName, (into.get(rule.itemName) ?? 0) + qty);
      }
    });
}

function computeLocationHardware(location: SalesQuoteLocation, rules: SiteHardwareRule[]): Array<{ itemName: string; qty: number }> {
  const totals = new Map<string, number>();
  accumulateLocationHardware(location, rules, totals);
  return Array.from(totals.entries()).map(([itemName, qty]) => ({ itemName, qty }));
}

function computeQuoteHardware(locations: SalesQuoteLocation[], rules: SiteHardwareRule[]): Array<{ itemName: string; qty: number }> {
  const totals = new Map<string, number>();
  locations.forEach((location) => accumulateLocationHardware(location, rules, totals));
  return Array.from(totals.entries()).map(([itemName, qty]) => ({ itemName, qty }));
}

const SITE_HARDWARE_METRIC_OPTIONS: Array<{ value: SiteHardwareMetric; label: string }> = [
  { value: "fli", label: "FLI checked (flat qty)" },
  { value: "lpr", label: "LPR checked (flat qty)" },
  { value: "people_counting", label: "People Counting checked (flat qty)" },
  { value: "per_entry", label: "Per entry lane" },
  { value: "per_exit", label: "Per exit lane" },
  { value: "per_level", label: "Per level" },
];

const EMPTY_NEW_QUOTE_DRAFT = {
  clientName: "",
  siteName: "",
  city: "",
  garageCount: 1,
  lotCount: 0,
  contactFullName: "",
  clientEmail: "",
  contactPhone: "",
  preferredCommunication: "",
  siteStreetAddress: "",
  siteState: "",
  siteZip: "",
  clientStreetAddress: "",
  clientCity: "",
  clientState: "",
  clientZip: "",
};

// Shared shape for "create a new site" across App/SalesHome/SalesQuoteBuilder
// so the New Site draft, its handler, and its prop types can't drift apart
// as fields get added (which is exactly what happened before -- three
// separate hand-written copies of this object type).
type NewSiteInput = typeof EMPTY_NEW_QUOTE_DRAFT;

// Sale Design and Quote Builder. A quote starts with a client/site and a
// count of garages and parking lots -- entering those counts generates one
// location line item per garage/lot (see onCreateQuote/handleCreateSalesQuote
// in the App component) for the sales person to name and detail. The
// "Recommended Hardware" block per location is a deliberate placeholder: E
// asked for the inputs (FLI/LPR/people counting, entries/exits/levels) to
// exist now, with the rules engine that turns them into a camera/sign count
// built next -- it is not decorative, it is explicitly staged.
// Custom in-app camera for Site Builder photo batches -- opens the phone's
// camera directly (getUserMedia). The rep first picks Single Photo or Batch
// Images; Batch lets them snap as many photos as they want for this one
// garage/lot before reviewing anything, Single auto-advances to review
// after one shot. Review shows every shot together with a name field (the
// second half of "<Garage/Lot name> - <name>", used as the actual saved
// file name) and a chance to discard a bad one before saving the whole
// batch. If a save fails because the device is offline, the photo is
// queued in IndexedDB (see persistence.ts's offline photo queue) instead of
// being lost -- App.flushPendingSitePhotos uploads it automatically once
// the connection comes back.
type CapturedPhoto = { id: string; blob: Blob; previewUrl: string; name: string };

function sanitizePhotoNameSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim();
}

const DOCUMENT_UPLOAD_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".dwg", ".dxf", ".rvt", ".ifc", ".step", ".stp"];

function extensionOfFileName(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
}

function isAllowedPhotoFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?|svg)$/i.test(file.name);
}

function isAllowedLocationDocumentFile(file: File): boolean {
  return !isAllowedPhotoFile(file) && DOCUMENT_UPLOAD_EXTENSIONS.includes(extensionOfFileName(file.name));
}

// Structural "Like" shapes -- SalesQuoteLocationImage/Location and
// ProjectLocationImage/Location are separate types (different tables), but
// identical in shape for everything these shared UI components need, so one
// component works against either side without duplicating ~600 lines of
// JSX. TS structural typing means both real types satisfy these as-is.
type LocationImageLike = {
  id: string;
  imageType: "photo" | "drawing";
  storagePath: string;
  fileName: string;
  description: string;
  uploadedAt: string;
  uploadedByEmail: string;
  lat: number | null;
  lng: number | null;
};

type LocationLike = {
  id: string;
  name: string;
  locationType: "garage" | "lot";
  images: LocationImageLike[];
};

type CameraLensOption = {
  deviceId: string;
  label: string;
  lensType: "main" | "ultra-wide" | "unknown";
};

type CameraZoomCapability = { min?: number; max?: number; step?: number };

type ZoomableVideoTrack = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & { zoom?: CameraZoomCapability };
  getSettings?: () => MediaTrackSettings & { zoom?: number };
};

function classifyCameraLens(label: string): CameraLensOption["lensType"] {
  const normalized = label.toLowerCase();
  if (/(ultra[\s-]?wide|0\.5x|0,5x|wide angle|back triple|back dual)/i.test(normalized)) {
    return "ultra-wide";
  }
  if (/(back|rear|environment|main|wide)/i.test(normalized)) {
    return "main";
  }
  return "unknown";
}

function chooseMainCamera(lenses: CameraLensOption[]) {
  return lenses.find((lens) => lens.lensType === "main") ?? lenses.find((lens) => lens.lensType === "unknown") ?? lenses[0] ?? null;
}

function chooseUltraWideCamera(lenses: CameraLensOption[]) {
  return lenses.find((lens) => lens.lensType === "ultra-wide") ?? null;
}

// Best-effort GPS: the whole point of this photo capture flow is parking
// garages/structures, where indoor GPS is often weak or unavailable -- so
// this always resolves (never rejects the caller), just with null coords if
// location isn't available within the timeout.
function getBestEffortLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

function CameraCaptureModal({
  quoteId,
  locationId,
  locationName,
  ownerType = "quote",
  onClose,
  onSavePhoto,
}: {
  quoteId: string;
  locationId: string;
  locationName: string;
  // Which offline-queue owner bucket this belongs to -- see
  // persistence.ts's PendingSitePhoto.ownerType. Defaults to "quote" so the
  // existing Sales Site Builder call site doesn't need updating.
  ownerType?: "quote" | "project";
  onClose: () => void;
  onSavePhoto: (file: File, description: string, coords: { lat: number; lng: number } | null) => Promise<boolean>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"choose" | "camera" | "review">("choose");
  const [batchMode, setBatchMode] = useState(true);
  const [cameraError, setCameraError] = useState("");
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [cameraLenses, setCameraLenses] = useState<CameraLensOption[]>([]);
  const [activeLensId, setActiveLensId] = useState("");
  const [cameraZoom, setCameraZoom] = useState(1);
  const [cameraZoomRange, setCameraZoomRange] = useState({ min: 1, max: 1, step: 0.1 });
  const [cameraLensStatus, setCameraLensStatus] = useState("Camera zoom stays inside this viewer.");
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const cameraZoomRef = useRef(1);
  const activeLensIdRef = useRef("");
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const pointerEventsRef = useRef<Map<number, PointerEvent>>(new Map());

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (phase !== "camera" || coordsRef.current) {
      return;
    }
    // Best-effort, once per session in this modal -- indoors in a parking
    // structure this frequently comes back null, which is fine; it's a
    // when-available add-on, not something the save flow depends on.
    getBestEffortLocation().then((coords) => {
      coordsRef.current = coords;
    });
  }, [phase]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function loadCameraLenses() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((device) => device.kind === "videoinput");
    const rearInputs = videoInputs.filter((device) => /(back|rear|environment|wide|ultra)/i.test(device.label));
    const candidates = rearInputs.length ? rearInputs : videoInputs;
    const lenses = candidates.map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
      lensType: classifyCameraLens(device.label),
    }));
    setCameraLenses(lenses);
    return lenses;
  }

  function applyZoomToCurrentTrack(nextZoom: number) {
    const track = streamRef.current?.getVideoTracks()[0] as ZoomableVideoTrack | undefined;
    const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: CameraZoomCapability }) | undefined;
    const zoomCapability = capabilities?.zoom;
    if (!track || !zoomCapability) {
      setCameraLensStatus(cameraLenses.length > 1 ? "This browser exposes multiple lenses, but not hardware zoom controls." : "Hardware zoom is controlled by this phone/browser.");
      return false;
    }
    const min = zoomCapability.min ?? 1;
    const max = zoomCapability.max ?? Math.max(1, nextZoom);
    const clamped = Math.min(max, Math.max(min, nextZoom));
    track.applyConstraints({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] }).catch(() => undefined);
    cameraZoomRef.current = clamped;
    setCameraZoom(clamped);
    setCameraZoomRange({ min, max, step: zoomCapability.step ?? 0.1 });
    return true;
  }

  async function startCamera(deviceId?: string, requestedZoom = cameraZoomRef.current) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser can't access the camera directly. Use the file picker below instead.");
      return;
    }
    stopCamera();
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      const lenses = await loadCameraLenses();
      const track = stream.getVideoTracks()[0] as ZoomableVideoTrack | undefined;
      const settings = track?.getSettings?.();
      const activeDeviceId = settings?.deviceId || deviceId || "";
      activeLensIdRef.current = activeDeviceId;
      setActiveLensId(activeDeviceId);
      const zoomApplied = applyZoomToCurrentTrack(requestedZoom);
      const activeLens = lenses.find((lens) => lens.deviceId === activeDeviceId);
      setCameraLensStatus(
        activeLens?.lensType === "ultra-wide"
          ? "Ultra-wide camera active. Pinch or wheel in to return to the main lens when available."
          : lenses.some((lens) => lens.lensType === "ultra-wide")
            ? "Main camera active. Pinch or wheel out past minimum to use ultra-wide if exposed."
            : zoomApplied
              ? "Pinch or mouse wheel to zoom inside the camera viewer."
              : "This phone/browser handles camera zoom automatically.",
      );
    } catch {
      setCameraError("Could not access the camera (permission denied or unavailable). Use the file picker below instead.");
    }
  }

  useEffect(() => {
    if (phase !== "camera") {
      return;
    }
    void startCamera(activeLensIdRef.current || undefined);
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function switchLens(target: CameraLensOption, requestedZoom: number) {
    activeLensIdRef.current = target.deviceId;
    setActiveLensId(target.deviceId);
    cameraZoomRef.current = requestedZoom;
    setCameraZoom(requestedZoom);
    await startCamera(target.deviceId, requestedZoom);
  }

  function getPointerDistanceFromMap() {
    const [first, second] = Array.from(pointerEventsRef.current.values());
    if (!first || !second) {
      return 0;
    }
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
  }

  async function requestCameraZoom(nextZoom: number) {
    const mainLens = chooseMainCamera(cameraLenses);
    const ultraWideLens = chooseUltraWideCamera(cameraLenses);
    const activeLens = cameraLenses.find((lens) => lens.deviceId === activeLensIdRef.current) ?? null;
    const min = cameraZoomRange.min;
    const max = cameraZoomRange.max;

    if (nextZoom < min && ultraWideLens && activeLens?.deviceId !== ultraWideLens.deviceId) {
      await switchLens(ultraWideLens, 1);
      return;
    }

    if (nextZoom > 1.15 && mainLens && activeLens?.lensType === "ultra-wide") {
      await switchLens(mainLens, 1);
      return;
    }

    const clamped = Math.min(max, Math.max(min, nextZoom));
    cameraZoomRef.current = clamped;
    setCameraZoom(clamped);
    applyZoomToCurrentTrack(clamped);
  }

  function handleCameraWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    void requestCameraZoom(cameraZoomRef.current + (event.deltaY > 0 ? -0.16 : 0.16));
  }

  function handleCameraPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerEventsRef.current.set(event.pointerId, event.nativeEvent);
    if (pointerEventsRef.current.size === 2) {
      pinchRef.current = { distance: getPointerDistanceFromMap(), zoom: cameraZoomRef.current };
    }
  }

  function handleCameraPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointerEventsRef.current.has(event.pointerId)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    pointerEventsRef.current.set(event.pointerId, event.nativeEvent);
    if (pointerEventsRef.current.size === 2 && pinchRef.current) {
      const startDistance = pinchRef.current.distance || getPointerDistanceFromMap();
      const nextDistance = getPointerDistanceFromMap();
      if (startDistance > 0 && nextDistance > 0) {
        void requestCameraZoom(pinchRef.current.zoom * (nextDistance / startDistance));
      }
    }
  }

  function handleCameraPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    pointerEventsRef.current.delete(event.pointerId);
    if (pointerEventsRef.current.size < 2) {
      pinchRef.current = null;
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          return;
        }
        const previewUrl = URL.createObjectURL(blob);
        setPhotos((current) => [...current, { id: makeId("photo"), blob, previewUrl, name: "" }]);
        if (!batchMode) {
          stopCamera();
          setPhase("review");
        }
      },
      "image/jpeg",
      0.9,
    );
  }

  function handleFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      if (!isAllowedPhotoFile(file)) {
        window.alert("Photos only accept image files. Use Files for PDF, Word, Excel, CAD, and other documents.");
        event.target.value = "";
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      setPhotos((current) => [...current, { id: makeId("photo"), blob: file, previewUrl, name: "" }]);
      if (!batchMode) {
        setPhase("review");
      }
    }
    event.target.value = "";
  }

  function discardPhoto(id: string) {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((photo) => photo.id !== id);
    });
  }

  function goToReview() {
    stopCamera();
    setPhase("review");
  }

  function handleClose() {
    stopCamera();
    photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    onClose();
  }

  async function saveAll() {
    setIsSaving(true);
    setSaveError("");
    let queuedOffline = 0;
    for (const photo of photos) {
      const namedSegment = sanitizePhotoNameSegment(photo.name) || "photo";
      const fileName = `${sanitizePhotoNameSegment(locationName)} - ${namedSegment}.jpg`;
      const fileType = photo.blob.type || "image/jpeg";
      const file = new File([photo.blob], fileName, { type: fileType });
      let ok = false;
      try {
        ok = await onSavePhoto(file, photo.name.trim(), coordsRef.current);
      } catch (error) {
        console.error("Photo save failed", error);
        ok = false;
      }
      if (!ok) {
        // Could be offline (common in a parking garage), but a failed save
        // can just as easily mean a real upload problem while online --
        // either way, queue it in IndexedDB instead of losing it.
        // persistence.ts logs the actual status/error to the console so a
        // real failure isn't mistaken for "no connection."
        await queuePendingSitePhoto({
          quoteId,
          locationId,
          fileName,
          fileType,
          description: photo.name.trim(),
          blob: photo.blob,
          ownerType,
          lat: coordsRef.current?.lat ?? null,
          lng: coordsRef.current?.lng ?? null,
        });
        queuedOffline += 1;
      }
    }
    setIsSaving(false);
    photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    if (queuedOffline > 0) {
      const reason = navigator.onLine
        ? "There was a problem uploading them even though this device is online -- check the browser console for details, or contact support if this keeps happening"
        : "they'll upload automatically once you're back online";
      window.alert(`${queuedOffline} of ${photos.length} photo(s) saved on this device -- ${reason}.`);
    }
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel camera-capture-modal" role="dialog" aria-modal="true" aria-labelledby="camera-capture-title">
        <div className="modal-header">
          <div>
            <h2 id="camera-capture-title">Photos: {locationName}</h2>
            <p>
              {phase === "choose"
                ? "Take one photo, or capture a batch before reviewing."
                : phase === "camera"
                  ? batchMode
                    ? "Take as many photos as you need, then review before saving."
                    : "Take your photo."
                  : "Name each photo (it's saved as \"" + locationName + " - <name>\"), discard any you don't want, then save."}
            </p>
          </div>
          <button className="icon-button" type="button" onClick={handleClose} aria-label="Close camera">x</button>
        </div>

        {phase === "choose" && (
          <div className="camera-mode-choice">
            <button
              className="secondary-action camera-mode-choice-button"
              type="button"
              onClick={() => {
                setBatchMode(false);
                setPhase("camera");
              }}
            >
              <Camera size={18} />
              <span>Single Photo</span>
              <small className="muted">Take one shot, then name and save it.</small>
            </button>
            <button
              className="primary-action camera-mode-choice-button"
              type="button"
              onClick={() => {
                setBatchMode(true);
                setPhase("camera");
              }}
            >
              <Camera size={18} />
              <span>Batch Images</span>
              <small>Take several shots in a row, then name and save them all together.</small>
            </button>
          </div>
        )}

        {phase === "camera" && (
          <div className="camera-capture-live">
            {cameraError ? (
              <div className="camera-capture-fallback">
                <p className="muted">{cameraError}</p>
                <label className="secondary-action mini-action hidden-file-label">
                  Choose photo from files
                  <input type="file" accept="image/*" capture="environment" onChange={handleFilePicked} />
                </label>
              </div>
            ) : (
              <>
                <div
                  className="camera-viewport"
                  onWheel={handleCameraWheel}
                  onPointerDown={handleCameraPointerDown}
                  onPointerMove={handleCameraPointerMove}
                  onPointerUp={handleCameraPointerEnd}
                  onPointerCancel={handleCameraPointerEnd}
                >
                  <video ref={videoRef} className="camera-capture-video" autoPlay playsInline muted />
                </div>
                <div className="camera-zoom-toolbar">
                  <span>{cameraLensStatus}</span>
                  <div>
                    <button className="icon-button" type="button" onClick={() => void requestCameraZoom(cameraZoomRef.current - 0.5)} aria-label="Zoom out">
                      <ZoomOut size={16} />
                    </button>
                    <strong>{Math.round(cameraZoom * 100)}%</strong>
                    <button className="icon-button" type="button" onClick={() => void requestCameraZoom(cameraZoomRef.current + 0.5)} aria-label="Zoom in">
                      <ZoomIn size={16} />
                    </button>
                  </div>
                </div>
                {cameraLenses.length > 1 && (
                  <div className="camera-lens-row" aria-label="Camera lens selector">
                    {cameraLenses.map((lens) => (
                      <button
                        className={lens.deviceId === activeLensId ? "active" : ""}
                        type="button"
                        key={lens.deviceId}
                        onClick={() => void switchLens(lens, 1)}
                      >
                        {lens.lensType === "ultra-wide" ? "0.5x" : lens.lensType === "main" ? "1x" : "Cam"} {lens.label.replace(/\s*\([^)]*\)/g, "").slice(0, 24)}
                      </button>
                    ))}
                  </div>
                )}
                <button className="primary-action camera-capture-shutter" type="button" onClick={capturePhoto}>
                  <Camera size={20} /> Capture
                </button>
              </>
            )}
            {photos.length > 0 && (
              <div className="camera-capture-thumb-row">
                {photos.map((photo) => (
                  <img key={photo.id} src={photo.previewUrl} alt="Captured" className="camera-capture-thumb" />
                ))}
              </div>
            )}
            {batchMode && (
              <div className="modal-actions">
                <button className="secondary-action" type="button" onClick={handleClose}>Cancel</button>
                <button className="primary-action" type="button" disabled={photos.length === 0} onClick={goToReview}>
                  Review {photos.length > 0 ? `(${photos.length})` : ""}
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "review" && (
          <div className="camera-capture-review">
            {photos.length === 0 && <p className="empty-compact-state">No photos captured.</p>}
            {photos.map((photo) => (
              <div className="camera-capture-review-row" key={photo.id}>
                <img src={photo.previewUrl} alt="Captured" className="camera-capture-review-thumb" />
                <div className="camera-capture-name-row">
                  <span className="camera-capture-name-prefix">{locationName} -</span>
                  <input
                    className="camera-capture-review-description"
                    value={photo.name}
                    placeholder="Name (e.g. Entrance, Level 2 ramp)"
                    onChange={(event) => setPhotos((current) => current.map((entry) => (entry.id === photo.id ? { ...entry, name: event.target.value } : entry)))}
                  />
                </div>
                <button className="secondary-action mini-action" type="button" onClick={() => discardPhoto(photo.id)}>Discard</button>
              </div>
            ))}
            {saveError && <small className="error-text">{saveError}</small>}
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setPhase("camera")}>Take more</button>
              <button className="primary-action" type="button" disabled={photos.length === 0 || isSaving} onClick={saveAll}>
                {isSaving ? "Saving..." : `Save ${photos.length} photo(s)`}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// #202/203 -- per-location "Files" viewer. Uploading a drawing/doc already
// existed (the small Upload icon next to Photos), but there was no way to
// actually see or manage what had been uploaded -- this gives that a real
// list with Download/Delete, plus the upload control itself so it's not
// spread across two different UI spots.
// A quick "is this actually the right file" check before trusting it --
// PDFs render in an <iframe> (browsers natively display PDFs there) and
// images in an <img>; anything else (Word/Excel) has no reliable in-browser
// renderer, so it just says so and points at Download instead.
function isPreviewablePdf(fileName: string): boolean {
  return /\.pdf$/i.test(fileName);
}

function isPreviewableImage(fileName: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
}

// E's request: images should be traceable from presale through closeout --
// who took/uploaded it, when, and (best-effort) where. Only ever populated
// going forward (see migration 064), so this is blank for anything older.
function formatImageProvenance(image: LocationImageLike): string {
  const parts: string[] = [];
  if (image.uploadedAt) {
    const date = new Date(image.uploadedAt);
    if (!Number.isNaN(date.getTime())) {
      parts.push(date.toLocaleString());
    }
  }
  if (image.uploadedByEmail) {
    parts.push(`by ${image.uploadedByEmail}`);
  }
  if (image.lat != null && image.lng != null) {
    parts.push(`${image.lat.toFixed(5)}, ${image.lng.toFixed(5)}`);
  }
  return parts.join(" -- ");
}

function formatDocumentProvenance(doc: UploadedDoc): string {
  const parts: string[] = [];
  if (doc.uploadedAt) {
    const date = new Date(doc.uploadedAt);
    if (!Number.isNaN(date.getTime())) {
      parts.push(date.toLocaleString());
    }
  }
  if (doc.uploadedByEmail) {
    parts.push(`by ${doc.uploadedByEmail}`);
  }
  if (doc.storage) {
    parts.push(doc.storage);
  }
  return parts.join(" -- ");
}

function clampPreviewZoom(value: number) {
  return Math.min(5, Math.max(1, value));
}

function getPointerDistance(first: PointerEvent, second: PointerEvent) {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function ZoomablePreviewImage({ src, alt }: { src: string; alt: string }) {
  const pointersRef = useRef<Map<number, PointerEvent>>(new Map());
  const dragRef = useRef({ startX: 0, startY: 0, x: 0, y: 0 });
  const pinchRef = useRef({ distance: 0, scale: 1 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    pointersRef.current.clear();
    dragRef.current = { startX: 0, startY: 0, x: 0, y: 0 };
    pinchRef.current = { distance: 0, scale: 1 };
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  function updateScale(nextScale: number) {
    const clamped = clampPreviewZoom(nextScale);
    setScale(clamped);
    if (clamped === 1) {
      setOffset({ x: 0, y: 0 });
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    updateScale(scale + (event.deltaY > 0 ? -0.18 : 0.18));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, event.nativeEvent);
    if (pointersRef.current.size === 1) {
      dragRef.current = { startX: event.clientX, startY: event.clientY, x: offset.x, y: offset.y };
    }
    if (pointersRef.current.size === 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      pinchRef.current = { distance: getPointerDistance(first, second), scale };
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }
    pointersRef.current.set(event.pointerId, event.nativeEvent);
    if (pointersRef.current.size === 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      const startDistance = pinchRef.current.distance || getPointerDistance(first, second);
      updateScale(pinchRef.current.scale * (getPointerDistance(first, second) / startDistance));
      return;
    }
    if (scale <= 1) {
      return;
    }
    setOffset({
      x: dragRef.current.x + event.clientX - dragRef.current.startX,
      y: dragRef.current.y + event.clientY - dragRef.current.startY,
    });
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 1) {
      const [remaining] = Array.from(pointersRef.current.values());
      dragRef.current = { startX: remaining.clientX, startY: remaining.clientY, x: offset.x, y: offset.y };
    }
  }

  return (
    <div className="zoom-preview">
      <div className="zoom-preview-toolbar" aria-label="Image zoom controls">
        <button className="icon-button" type="button" onClick={() => updateScale(scale - 0.5)} aria-label="Zoom out">
          <ZoomOut size={16} />
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button className="icon-button" type="button" onClick={() => updateScale(scale + 0.5)} aria-label="Zoom in">
          <ZoomIn size={16} />
        </button>
        <button className="secondary-action zoom-reset-button" type="button" onClick={() => updateScale(1)}>
          Reset
        </button>
      </div>
      <div
        className="zoom-preview-frame"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <img
          src={src}
          alt={alt}
          className="file-preview-image"
          draggable={false}
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }}
        />
      </div>
    </div>
  );
}

function MediaPreviewModal({
  file,
  url,
  locations,
  currentLocationId,
  onSave,
  onMove,
  onClose,
}: {
  file: LocationImageLike;
  url: string | null;
  locations: LocationLike[];
  currentLocationId: string;
  onSave: (updates: { fileName: string; description: string }) => Promise<boolean> | boolean;
  onMove: (targetLocationId: string) => Promise<boolean> | boolean;
  onClose: () => void;
}) {
  const [fileNameDraft, setFileNameDraft] = useState(file.fileName);
  const [descriptionDraft, setDescriptionDraft] = useState(file.description);
  const [targetLocationId, setTargetLocationId] = useState(currentLocationId);
  const [status, setStatus] = useState("");
  const isPhoto = file.imageType === "photo";

  async function handleSave() {
    setStatus("Saving...");
    const ok = await onSave({ fileName: fileNameDraft, description: descriptionDraft });
    setStatus(ok ? "Saved." : "Could not save changes.");
  }

  async function handleMove() {
    if (targetLocationId === currentLocationId) {
      return;
    }
    const target = locations.find((location) => location.id === targetLocationId);
    if (!window.confirm(`Move "${file.fileName}" to ${target?.name || "the selected location"}?`)) {
      return;
    }
    setStatus("Moving...");
    const ok = await onMove(targetLocationId);
    setStatus(ok ? "Moved." : "Could not move file.");
    if (ok) {
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel file-preview-modal" role="dialog" aria-modal="true" aria-labelledby="file-preview-title">
        <div className="modal-header">
          <div>
            <h2 id="file-preview-title">{file.fileName}</h2>
            <p>{isPhoto ? "Photo preview" : "File preview"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close preview">x</button>
        </div>
        <div className="media-provenance-strip">
          <span>{file.imageType === "photo" ? "Image" : "File"}</span>
          <span>{file.uploadedAt ? new Date(file.uploadedAt).toLocaleString() : "No timestamp saved"}</span>
          <span>{file.uploadedByEmail || "Uploader not saved"}</span>
          {file.lat != null && file.lng != null && <span>{file.lat.toFixed(5)}, {file.lng.toFixed(5)}</span>}
        </div>
        {!url && <p className="muted">Loading preview...</p>}
        {url && isPreviewablePdf(file.fileName) && <iframe src={url} className="file-preview-frame" title={file.fileName} />}
        {url && isPreviewableImage(file.fileName) && <ZoomablePreviewImage src={url} alt={file.fileName} />}
        {url && !isPreviewablePdf(file.fileName) && !isPreviewableImage(file.fileName) && (
          <p className="empty-compact-state">Preview isn't available for this file type -- use Download instead.</p>
        )}
        <div className="media-preview-editor">
          <label>
            File name
            <input value={fileNameDraft} onChange={(event) => setFileNameDraft(event.target.value)} />
          </label>
          <label>
            Notes
            <textarea rows={3} value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} placeholder="Add notes for this image/file..." />
          </label>
          <label>
            Move to garage/lot
            <select value={targetLocationId} onChange={(event) => setTargetLocationId(event.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name || (location.locationType === "garage" ? "Garage" : "Lot")}
                </option>
              ))}
            </select>
          </label>
          {status && <small className="muted">{status}</small>}
          <div className="modal-actions">
            <button className="secondary-action" type="button" onClick={handleSave}>Save details</button>
            <button className="primary-action" type="button" disabled={targetLocationId === currentLocationId} onClick={handleMove}>Move</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function LocationFilesModal({
  locationName,
  locationId,
  locations,
  files,
  onUpload,
  onDownload,
  onDelete,
  onGetUrl,
  onUpdate,
  onMove,
  onClose,
}: {
  locationName: string;
  locationId: string;
  locations: LocationLike[];
  files: LocationImageLike[];
  onUpload: (file: File) => void;
  onDownload: (image: LocationImageLike) => void;
  onDelete: (image: LocationImageLike) => Promise<boolean>;
  onGetUrl: (image: LocationImageLike) => Promise<string | null>;
  onUpdate: (image: LocationImageLike, updates: { fileName: string; description: string }) => Promise<boolean> | boolean;
  onMove: (image: LocationImageLike, targetLocationId: string) => Promise<boolean> | boolean;
  onClose: () => void;
}) {
  const [deletingId, setDeletingId] = useState("");
  const [previewFile, setPreviewFile] = useState<LocationImageLike | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");

  async function handleDelete(image: LocationImageLike) {
    if (!window.confirm(`Delete "${image.fileName}"? This can't be undone.`)) {
      return;
    }
    setDeletingId(image.id);
    await onDelete(image);
    setDeletingId("");
  }

  async function handlePreview(image: LocationImageLike) {
    setPreviewFile(image);
    setPreviewUrl(null);
    const url = await onGetUrl(image);
    setPreviewUrl(url);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="location-files-title">
        <div className="modal-header">
          <div>
            <h2 id="location-files-title">Files: {locationName}</h2>
            <p>Drawings or other documents for this garage/lot.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close files">x</button>
        </div>
        <label className="secondary-action mini-action hidden-file-label">
          <Upload size={14} /> Upload file
          <input
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.dwg,.dxf,.rvt,.ifc,.step,.stp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                if (isAllowedLocationDocumentFile(file)) {
                  setUploadError("");
                  onUpload(file);
                } else {
                  setUploadError("Files accepts PDF, Word, Excel/CSV, and CAD/reference files only. Put pictures in Photos.");
                }
              }
              event.target.value = "";
            }}
          />
        </label>
        <div className="upload-rule-note">
          <FileText size={15} />
          <span>Files stay separate from Photos. Every upload is stamped with date, time, and uploader.</span>
        </div>
        {uploadError && <small className="error-text">{uploadError}</small>}
        <ul className="line-list location-file-list">
          {files.map((file) => (
            <li
              className="line-item location-file-row"
              key={file.id}
              role="button"
              tabIndex={0}
              title="Open preview"
              onClick={() => handlePreview(file)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handlePreview(file);
                }
              }}
            >
              <div className="location-file-meta">
                <strong>{file.fileName}</strong>
                {file.description && <span>{file.description}</span>}
                <small className="muted">{formatImageProvenance(file)}</small>
              </div>
              <div className="location-file-actions">
                <button
                  className="icon-button location-file-icon"
                  type="button"
                  title={`Download ${file.fileName}`}
                  aria-label={`Download ${file.fileName}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDownload(file);
                  }}
                >
                  <Download size={16} />
                </button>
                <button
                  className="icon-button location-file-icon"
                  type="button"
                  title={`Delete ${file.fileName}`}
                  aria-label={`Delete ${file.fileName}`}
                  disabled={deletingId === file.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDelete(file);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
          {files.length === 0 && <li className="empty-compact-state">No files uploaded yet.</li>}
        </ul>
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>Close</button>
        </div>
      </section>
      {previewFile && (
        <MediaPreviewModal
          file={previewFile}
          url={previewUrl}
          locations={locations}
          currentLocationId={locationId}
          onSave={(updates) => onUpdate(previewFile, updates)}
          onMove={(targetLocationId) => onMove(previewFile, targetLocationId)}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}

// #201/204 -- site-wide Photo Gallery: every photo across every garage/lot
// for this one site, grouped by location, with a real visual thumbnail
// (fetched as a signed URL per photo -- the bucket is private, so there's
// no way to just point an <img> at the storage path directly) and a
// checkbox per photo so a batch can be downloaded or deleted together.
function SiteGalleryModal({
  siteName,
  locations,
  onGetUrl,
  onUpdate,
  onMove,
  onDelete,
  onClose,
}: {
  siteName: string;
  locations: LocationLike[];
  onGetUrl: (image: LocationImageLike) => Promise<string | null>;
  onUpdate: (locationId: string, image: LocationImageLike, updates: { fileName: string; description: string }) => Promise<boolean> | boolean;
  onMove: (fromLocationId: string, image: LocationImageLike, targetLocationId: string) => Promise<boolean> | boolean;
  onDelete: (locationId: string, image: LocationImageLike) => Promise<boolean>;
  onClose: () => void;
}) {
  const [urlsByImageId, setUrlsByImageId] = useState<Record<string, string>>({});
  const [loadingUrls, setLoadingUrls] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isWorking, setIsWorking] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ locationId: string; image: LocationImageLike } | null>(null);

  const groups = locations
    .map((location) => ({ location, photos: location.images.filter((image) => image.imageType === "photo") }))
    .filter((group) => group.photos.length > 0);
  const allPhotoIds = groups.flatMap((group) => group.photos.map((photo) => photo.id)).join(",");

  useEffect(() => {
    let cancelled = false;
    const allPhotos = groups.flatMap((group) => group.photos);
    setLoadingUrls(true);
    Promise.all(
      allPhotos.map(async (photo) => {
        const url = await onGetUrl(photo);
        return [photo.id, url] as const;
      }),
    ).then((pairs) => {
      if (cancelled) {
        return;
      }
      const next: Record<string, string> = {};
      pairs.forEach(([id, url]) => {
        if (url) {
          next[id] = url;
        }
      });
      setUrlsByImageId(next);
      setLoadingUrls(false);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch signed URLs whenever the underlying photo set changes (e.g.
    // right after a delete removes one) -- allPhotoIds is a stable string
    // key derived from that set, safe to use as the effect dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPhotoIds]);

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(groups.flatMap((group) => group.photos.map((photo) => photo.id))));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function downloadSelected() {
    for (const group of groups) {
      for (const photo of group.photos) {
        if (selectedIds.has(photo.id)) {
          const url = urlsByImageId[photo.id];
          if (url) {
            // Sequential, not Promise.all -- most browsers block a burst of
            // simultaneous downloads/tabs as popups, so these go one at a
            // time instead of all firing at once.
            await triggerBrowserDownload(url, photo.fileName || "photo");
          }
        }
      }
    }
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) {
      return;
    }
    if (!window.confirm(`Delete ${selectedIds.size} photo(s)? This can't be undone.`)) {
      return;
    }
    setIsWorking(true);
    for (const group of groups) {
      for (const photo of group.photos) {
        if (selectedIds.has(photo.id)) {
          await onDelete(group.location.id, photo);
        }
      }
    }
    setIsWorking(false);
    clearSelection();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel site-gallery-modal" role="dialog" aria-modal="true" aria-labelledby="site-gallery-title">
        <div className="modal-header">
          <div>
            <h2 id="site-gallery-title">Photo Gallery: {siteName}</h2>
            <p>{groups.reduce((sum, group) => sum + group.photos.length, 0)} photo(s) across {groups.length} location(s).</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close gallery">x</button>
        </div>

        <div className="quote-header-pill-row">
          <button className="secondary-action mini-action" type="button" onClick={selectAll} disabled={groups.length === 0}>Select all</button>
          <button className="secondary-action mini-action" type="button" onClick={clearSelection} disabled={selectedIds.size === 0}>Clear</button>
          <button className="secondary-action mini-action" type="button" onClick={downloadSelected} disabled={selectedIds.size === 0}>
            Download ({selectedIds.size})
          </button>
          <button className="secondary-action mini-action" type="button" onClick={deleteSelected} disabled={selectedIds.size === 0 || isWorking}>
            {isWorking ? "Deleting..." : `Delete (${selectedIds.size})`}
          </button>
        </div>
        <div className="upload-rule-note">
          <Image size={15} />
          <span>Photo Gallery accepts image uploads only. PDFs, Word, Excel, and CAD files belong in Files so field photos stay clean.</span>
        </div>

        {loadingUrls && <p className="muted">Loading photos...</p>}
        {!loadingUrls && groups.length === 0 && <p className="empty-compact-state">No photos saved for this site yet.</p>}

        {!loadingUrls &&
          groups.map(({ location, photos }) => (
            <div className="modal-section" key={location.id}>
              <span className="modal-section-title">{location.name || (location.locationType === "garage" ? "Garage" : "Lot")}</span>
              <div className="site-gallery-grid">
                {photos.map((photo) => (
                  <div className={`site-gallery-item ${selectedIds.has(photo.id) ? "selected" : ""}`} key={photo.id}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(photo.id)}
                      onChange={() => toggleSelected(photo.id)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    {urlsByImageId[photo.id] ? (
                      <button className="site-gallery-preview-button" type="button" onClick={() => setPreviewFile({ locationId: location.id, image: photo })}>
                        <img src={urlsByImageId[photo.id]} alt={photo.description || photo.fileName} />
                      </button>
                    ) : (
                      <div className="site-gallery-item-fallback">No preview</div>
                    )}
                    {photo.description && <span className="site-gallery-caption">{photo.description}</span>}
                    <span className="site-gallery-caption muted">{formatImageProvenance(photo)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        {previewFile && (
          <MediaPreviewModal
            file={previewFile.image}
            url={urlsByImageId[previewFile.image.id] ?? null}
            locations={locations}
            currentLocationId={previewFile.locationId}
            onSave={(updates) => onUpdate(previewFile.locationId, previewFile.image, updates)}
            onMove={(targetLocationId) => onMove(previewFile.locationId, previewFile.image, targetLocationId)}
            onClose={() => setPreviewFile(null)}
          />
        )}
      </section>
    </div>
  );
}

// Shared "addable catalog-linked line" list used by the Sign / Space
// Sensor / Misc sections in a location's details modal -- same
// list-plus-add-row shape as the Quote BOM list above, just always tied to
// a real catalog item (no free-text option) and scoped to one location
// instead of the whole quote.
// Every row here is "where in this garage/lot" (free text -- e.g.
// "Entrance", "Level 2") + a catalog-scoped type pick + qty, plus an
// optional accessory (scoped to catalog items tagged for this section,
// e.g. "Camera accessory") + its own qty. Same row shape for Cameras,
// Signs, and Space Sensors -- Misc reuses it too rather than a separate
// simpler layout, since it's the same shared component either way.
function LocationItemLineSection({
  title,
  hint,
  items,
  catalogItems,
  options,
  accessoryOptions,
  draft,
  onDraftChange,
  onAdd,
  onUpdateItem,
  onDelete,
}: {
  title: string;
  hint: string;
  items: Array<{ id: string; catalogItemId: string | null; qty: number; locationLabel: string; accessoryCatalogItemId: string | null; accessoryQty: number }>;
  catalogItems: CatalogItem[];
  options: CatalogItem[];
  accessoryOptions: CatalogItem[];
  draft: { catalogItemId: string; qty: number; locationLabel: string; accessoryCatalogItemId: string; accessoryQty: number };
  onDraftChange: (draft: { catalogItemId: string; qty: number; locationLabel: string; accessoryCatalogItemId: string; accessoryQty: number }) => void;
  onAdd: () => void;
  onUpdateItem: (itemId: string, updates: Partial<{ qty: number; locationLabel: string; accessoryCatalogItemId: string | null; accessoryQty: number }>) => void;
  onDelete: (itemId: string) => void;
}) {
  return (
    <div className="quote-hardware-summary">
      <span className="label">{title}</span>
      <p className="muted">{hint}</p>
      <ul className="line-list">
        {items.map((line) => {
          const catalogItem = line.catalogItemId ? catalogItems.find((item) => item.id === line.catalogItemId) : undefined;
          const accessoryItem = line.accessoryCatalogItemId ? catalogItems.find((item) => item.id === line.accessoryCatalogItemId) : undefined;
          return (
            <li className="line-item location-line-item" key={line.id}>
              <div className="location-line-fields">
                <label>Location
                  <input
                    value={line.locationLabel}
                    placeholder="e.g. Entrance"
                    onChange={(event) => onUpdateItem(line.id, { locationLabel: event.target.value })}
                  />
                </label>
                <div>
                  <strong>{catalogItem ? catalogItem.productName : "Item removed from catalog"}</strong>
                  <label className="muted">Qty
                    <input
                      className="qty-input-narrow"
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={line.qty}
                      onChange={(event) => onUpdateItem(line.id, { qty: Number(event.target.value) || 0 })}
                    />
                  </label>
                </div>
                <label>Accessory
                  <select
                    value={line.accessoryCatalogItemId ?? ""}
                    onChange={(event) => onUpdateItem(line.id, { accessoryCatalogItemId: event.target.value || null })}
                  >
                    <option value="">None</option>
                    {accessoryOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.productName}</option>
                    ))}
                    {accessoryItem && !accessoryOptions.some((item) => item.id === accessoryItem.id) && (
                      <option value={accessoryItem.id}>{accessoryItem.productName}</option>
                    )}
                  </select>
                </label>
                <label className="muted">Qty
                  <input
                    className="qty-input-narrow"
                    type="number"
                    min={0}
                    step={0.01}
                    disabled={!line.accessoryCatalogItemId}
                    value={line.accessoryQty}
                    onChange={(event) => onUpdateItem(line.id, { accessoryQty: Number(event.target.value) || 0 })}
                  />
                </label>
              </div>
              <button className="icon-button" type="button" onClick={() => onDelete(line.id)} aria-label="Remove line">x</button>
            </li>
          );
        })}
        {items.length === 0 && <li className="empty-compact-state">No lines yet.</li>}
      </ul>
      <div className="submittal-create-row">
        <input
          value={draft.locationLabel}
          placeholder="Location, e.g. Entrance"
          onChange={(event) => onDraftChange({ ...draft, locationLabel: event.target.value })}
        />
        <select value={draft.catalogItemId} onChange={(event) => onDraftChange({ ...draft, catalogItemId: event.target.value })}>
          <option value="">Select item...</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>{item.productName}</option>
          ))}
        </select>
        <input
          className="qty-input-narrow"
          type="number"
          min={0.01}
          step={0.01}
          value={draft.qty}
          onChange={(event) => onDraftChange({ ...draft, qty: Number(event.target.value) || 1 })}
        />
        <select value={draft.accessoryCatalogItemId} onChange={(event) => onDraftChange({ ...draft, accessoryCatalogItemId: event.target.value })}>
          <option value="">No accessory</option>
          {accessoryOptions.map((item) => (
            <option key={item.id} value={item.id}>{item.productName}</option>
          ))}
        </select>
        <input
          className="qty-input-narrow"
          type="number"
          min={0}
          step={0.01}
          disabled={!draft.accessoryCatalogItemId}
          value={draft.accessoryQty}
          onChange={(event) => onDraftChange({ ...draft, accessoryQty: Number(event.target.value) || 0 })}
        />
        <button className="secondary-action mini-action" type="button" disabled={!draft.catalogItemId} onClick={onAdd}>
          + Add row
        </button>
      </div>
    </div>
  );
}

// PM shipping requests, fulfilled by Warehouse/Implementation: PM picks BOM
// lines + qty and a saved (or new) address, Warehouse packs it (photos
// prove what went in the box/pallet) then ships it (carrier + tracking) --
// which is when it actually deducts from inventory, same as Transfer to
// Project, just deferred until the thing is really out the door.
function ProjectShippingSection({
  project,
  onAddAddress,
  onAddShipment,
  onMarkPacked,
  onMarkShipped,
  onUploadPhoto,
  onDeletePhoto,
  onGetPhotoUrl,
}: {
  project: ProjectSite;
  onAddAddress: (address: { label: string; streetAddress: string; city: string; state: string; zip: string; attnName: string; phone: string }) => void;
  onAddShipment: (addressId: string | null, addressSnapshot: string, notes: string, lines: Array<{ itemName: string; qty: number }>) => void;
  onMarkPacked: (shipmentId: string) => void;
  onMarkShipped: (shipmentId: string, carrier: string, trackingNumber: string) => void;
  onUploadPhoto: (shipmentId: string, file: File, description?: string) => Promise<boolean>;
  onDeletePhoto: (shipmentId: string, photoId: string, storagePath: string) => Promise<boolean>;
  onGetPhotoUrl: (storagePath: string) => Promise<string | null>;
}) {
  const shipments = project.shipments ?? [];
  const addresses = project.shippingAddresses ?? [];
  const [showNewShipmentModal, setShowNewShipmentModal] = useState(false);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const selectedShipment = shipments.find((shipment) => shipment.id === selectedShipmentId) ?? null;

  const emptyAddressDraft = { label: "", streetAddress: "", city: "", state: "", zip: "", attnName: "", phone: "" };
  const [newAddressDraft, setNewAddressDraft] = useState(emptyAddressDraft);
  const [isAddingNewAddress, setIsAddingNewAddress] = useState(addresses.length === 0);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [shipmentLineQtys, setShipmentLineQtys] = useState<Record<string, number>>({});
  const [shipmentNotes, setShipmentNotes] = useState("");
  const [carrierDraft, setCarrierDraft] = useState("");
  const [trackingDraft, setTrackingDraft] = useState("");
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  useEffect(() => {
    if (!selectedShipment) {
      return;
    }
    let cancelled = false;
    selectedShipment.photos.forEach((photo) => {
      if (photoUrls[photo.id]) {
        return;
      }
      onGetPhotoUrl(photo.storagePath).then((url) => {
        if (!cancelled && url) {
          setPhotoUrls((current) => ({ ...current, [photo.id]: url }));
        }
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShipment?.id, selectedShipment?.photos.length]);

  function openNewShipmentModal() {
    setSelectedAddressId(addresses[0]?.id ?? "");
    setIsAddingNewAddress(addresses.length === 0);
    setNewAddressDraft(emptyAddressDraft);
    setShipmentLineQtys(Object.fromEntries(project.bom.map((line) => [line.item, 0])));
    setShipmentNotes("");
    setShowNewShipmentModal(true);
  }

  function submitNewShipment() {
    const lines = Object.entries(shipmentLineQtys)
      .filter(([, qty]) => qty > 0)
      .map(([itemName, qty]) => ({ itemName, qty }));
    if (lines.length === 0) {
      return;
    }
    if (isAddingNewAddress && newAddressDraft.streetAddress.trim()) {
      onAddAddress(newAddressDraft);
    }
    const address = addresses.find((entry) => entry.id === selectedAddressId);
    const addressSnapshot = isAddingNewAddress
      ? `${newAddressDraft.label ? `${newAddressDraft.label} -- ` : ""}${newAddressDraft.streetAddress}, ${newAddressDraft.city}, ${newAddressDraft.state} ${newAddressDraft.zip}`
      : address
        ? `${address.label ? `${address.label} -- ` : ""}${address.streetAddress}, ${address.city}, ${address.state} ${address.zip}`
        : "";
    onAddShipment(isAddingNewAddress ? null : selectedAddressId || null, addressSnapshot, shipmentNotes, lines);
    setShowNewShipmentModal(false);
  }

  async function handlePhotoSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedShipment) {
      return;
    }
    setIsUploadingPhoto(true);
    await onUploadPhoto(selectedShipment.id, file);
    setIsUploadingPhoto(false);
  }

  const selectedLineCount = Object.values(shipmentLineQtys).filter((qty) => qty > 0).length;

  return (
    <section className="panel full">
      <div className="panel-title-row">
        <div>
          <h2>Shipping</h2>
          <p>Request a shipment of BOM items to this project -- Warehouse/Implementation packs and ships it from here.</p>
        </div>
        <button
          className="primary-action"
          type="button"
          onClick={openNewShipmentModal}
          disabled={project.bom.length === 0}
          title={project.bom.length === 0 ? "Add at least one BOM material below first -- shipments are built from BOM lines." : undefined}
        >
          <Truck size={16} /> New Shipment
        </button>
      </div>
      {project.bom.length === 0 && <p className="muted">Add BOM material above first -- shipments are built from BOM lines.</p>}
      <div className="report-table compact-report-table">
        <div className="report-table-head"><span>Shipment</span><span>Status</span><span>Address</span><span>Items</span><span>Requested</span></div>
        {shipments.map((shipment) => (
          <div className="report-table-row clickable-row" key={shipment.id} onClick={() => setSelectedShipmentId(shipment.id)}>
            <span><strong>{shipment.shipmentNumber}</strong>{shipment.trackingNumber && <small>{shipment.carrier} -- {shipment.trackingNumber}</small>}</span>
            <span data-label="Status"><span className={`status ${shipment.status === "Shipped" ? "ok" : shipment.status === "Cancelled" ? "" : "warn"}`}>{shipment.status}</span></span>
            <span data-label="Address">{shipment.addressSnapshot || "No address"}</span>
            <span data-label="Items">{shipment.lines.length} line(s)</span>
            <span data-label="Requested">{shipment.requestedByEmail}<small>{new Date(shipment.requestedAt).toLocaleDateString()}</small></span>
          </div>
        ))}
        {shipments.length === 0 && <div className="empty-compact-state">No shipments requested yet.</div>}
      </div>

      {showNewShipmentModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-shipment-title">
            <div className="modal-header">
              <div>
                <h2 id="new-shipment-title">New Shipment</h2>
                <p>Pick which BOM items ship, and where. Saved addresses carry over to the next shipment.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowNewShipmentModal(false)} aria-label="Close new shipment">x</button>
            </div>

            <div className="compact-edit-section">
              <div className="compact-section-header">
                <div>
                  <h3>Ship to</h3>
                </div>
              </div>
              {addresses.length > 0 && !isAddingNewAddress && (
                <div className="bom-modal-grid">
                  <label className="span-2">Saved address
                    <select value={selectedAddressId} onChange={(event) => setSelectedAddressId(event.target.value)}>
                      {addresses.map((address) => (
                        <option key={address.id} value={address.id}>{address.label || address.streetAddress} -- {address.city}, {address.state}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {addresses.length > 0 && (
                <button className="link-button" type="button" onClick={() => setIsAddingNewAddress((current) => !current)}>
                  {isAddingNewAddress ? "Use a saved address instead" : "+ Use a new address"}
                </button>
              )}
              {isAddingNewAddress && (
                <div className="bom-modal-grid">
                  <label>Label<input value={newAddressDraft.label} placeholder="e.g. Garage A, Client office" onChange={(event) => setNewAddressDraft((current) => ({ ...current, label: event.target.value }))} /></label>
                  <label>Attn<input value={newAddressDraft.attnName} onChange={(event) => setNewAddressDraft((current) => ({ ...current, attnName: event.target.value }))} /></label>
                  <label className="span-2">Street address<input value={newAddressDraft.streetAddress} onChange={(event) => setNewAddressDraft((current) => ({ ...current, streetAddress: event.target.value }))} /></label>
                  <label>City<input value={newAddressDraft.city} onChange={(event) => setNewAddressDraft((current) => ({ ...current, city: event.target.value }))} /></label>
                  <label>State<input value={newAddressDraft.state} onChange={(event) => setNewAddressDraft((current) => ({ ...current, state: event.target.value }))} /></label>
                  <label>Zip<input value={newAddressDraft.zip} onChange={(event) => setNewAddressDraft((current) => ({ ...current, zip: event.target.value }))} /></label>
                  <label>Phone<input value={newAddressDraft.phone} onChange={(event) => setNewAddressDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
                </div>
              )}
            </div>

            <div className="compact-edit-section">
              <div className="compact-section-header">
                <div>
                  <h3>Items</h3>
                  <p>{selectedLineCount} of {project.bom.length} selected.</p>
                </div>
                <div className="report-filter-row">
                  <button className="secondary-action mini-action" type="button" onClick={() => setShipmentLineQtys(Object.fromEntries(project.bom.map((line) => [line.item, line.qty])))}>Select all (full qty)</button>
                  <button className="secondary-action mini-action" type="button" onClick={() => setShipmentLineQtys(Object.fromEntries(project.bom.map((line) => [line.item, 0])))}>Clear</button>
                </div>
              </div>
              <ul className="line-list">
                {project.bom.map((line) => (
                  <li className="line-item" key={line.item}>
                    <div>
                      <strong>{line.item}</strong>
                      <span>BOM qty: {line.qty}</span>
                    </div>
                    <input
                      className="qty-input-narrow"
                      type="number"
                      min={0}
                      step={1}
                      value={shipmentLineQtys[line.item] ?? 0}
                      onChange={(event) => setShipmentLineQtys((current) => ({ ...current, [line.item]: Number(event.target.value) || 0 }))}
                    />
                  </li>
                ))}
              </ul>
            </div>

            <div className="bom-modal-grid">
              <label className="span-2">Notes<textarea value={shipmentNotes} onChange={(event) => setShipmentNotes(event.target.value)} placeholder="Shipping instructions, urgency, special handling." /></label>
            </div>

            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowNewShipmentModal(false)}>Cancel</button>
              <button className="primary-action" type="button" disabled={selectedLineCount === 0} onClick={submitNewShipment}>Request Shipment</button>
            </div>
          </section>
        </div>
      )}

      {selectedShipment && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="shipment-detail-title">
            <div className="modal-header">
              <div>
                <h2 id="shipment-detail-title">{selectedShipment.shipmentNumber}</h2>
                <p>Requested by {selectedShipment.requestedByEmail} on {new Date(selectedShipment.requestedAt).toLocaleString()}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setSelectedShipmentId(null)} aria-label="Close shipment">x</button>
            </div>

            <div className="source-file"><MapPin size={16} /><span>{selectedShipment.addressSnapshot || "No address on file"}</span></div>
            {selectedShipment.notes && <div className="source-file"><FileText size={16} /><span>{selectedShipment.notes}</span></div>}

            <ul className="line-list">
              {selectedShipment.lines.map((line) => (
                <li className="line-item" key={line.id}>
                  <div><strong>{line.itemName}</strong></div>
                  <b>{line.qty}</b>
                </li>
              ))}
            </ul>

            <div className="compact-edit-section">
              <div className="compact-section-header">
                <div>
                  <h3>Packing photos</h3>
                  <p>Warehouse: photo of the box/pallet as proof of what was packed.</p>
                </div>
                <label className="secondary-action mini-action hidden-file-label">
                  <Camera size={14} /> {isUploadingPhoto ? "Uploading..." : "Add photo"}
                  <input type="file" accept="image/*" disabled={isUploadingPhoto} onChange={handlePhotoSelect} />
                </label>
              </div>
              {selectedShipment.photos.length > 0 ? (
                <div className="site-gallery-grid">
                  {selectedShipment.photos.map((photo) => (
                    <div className="site-gallery-item" key={photo.id}>
                      {photoUrls[photo.id] ? <img src={photoUrls[photo.id]} alt={photo.fileName} /> : <div className="site-gallery-item-fallback">Loading...</div>}
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => onDeletePhoto(selectedShipment.id, photo.id, photo.storagePath)}
                        aria-label="Remove photo"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-compact-state">No packing photos yet.</p>
              )}
            </div>

            {selectedShipment.status === "Requested" && (
              <div className="modal-actions">
                <button className="primary-action" type="button" onClick={() => onMarkPacked(selectedShipment.id)}>Mark Packed</button>
              </div>
            )}

            {selectedShipment.status === "Packed" && (
              <div className="compact-edit-section">
                <div className="compact-section-header">
                  <div>
                    <h3>Ship it</h3>
                    <p>Packed by {selectedShipment.packedByEmail} on {selectedShipment.packedAt ? new Date(selectedShipment.packedAt).toLocaleString() : ""}</p>
                  </div>
                </div>
                <div className="bom-modal-grid">
                  <label>Carrier<input value={carrierDraft} placeholder="e.g. FedEx, UPS, Freight" onChange={(event) => setCarrierDraft(event.target.value)} /></label>
                  <label>Tracking / label number<input value={trackingDraft} onChange={(event) => setTrackingDraft(event.target.value)} /></label>
                </div>
                <div className="modal-actions">
                  <button
                    className="primary-action"
                    type="button"
                    disabled={!carrierDraft.trim() || !trackingDraft.trim()}
                    onClick={() => {
                      onMarkShipped(selectedShipment.id, carrierDraft, trackingDraft);
                      setCarrierDraft("");
                      setTrackingDraft("");
                    }}
                  >
                    Mark Shipped
                  </button>
                </div>
              </div>
            )}

            {selectedShipment.status === "Shipped" && (
              <div className="source-file"><Truck size={16} /><span>Shipped by {selectedShipment.shippedByEmail} on {selectedShipment.shippedAt ? new Date(selectedShipment.shippedAt).toLocaleString() : ""} -- {selectedShipment.carrier} {selectedShipment.trackingNumber}</span></div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

// E's request: Sales info -- the per-garage/lot breakdown, photos, and
// drawings -- has to carry over into Projects in the same format, and keep
// growing through implementation and closeout (not just a frozen copy of
// what Sales had). This is the Project-side twin of Site Builder's location
// table + detail drawer, built against project_locations instead of
// sales_quote_locations, reusing the same LocationFilesModal /
// SiteGalleryModal / CameraCaptureModal / LocationItemLineSection so it
// looks and behaves identically.
function ProjectLocationsSection({
  project,
  catalogItems,
  onAddLocation,
  onUpdateLocation,
  onDeleteLocation,
  onAddLocationItem,
  onUpdateLocationItem,
  onDeleteLocationItem,
  onUploadImage,
  onDownloadImage,
  onDeleteImage,
  onGetImageUrl,
  onUpdateImageDescription,
  onUpdateImageMeta,
  onMoveImage,
}: {
  project: ProjectSite;
  catalogItems: CatalogItem[];
  onAddLocation: (locationType: "garage" | "lot") => void;
  onUpdateLocation: (locationId: string, updates: Parameters<typeof updateProjectLocation>[1]) => void;
  onDeleteLocation: (locationId: string) => void;
  onAddLocationItem: (locationId: string, lineType: ProjectLocationItem["lineType"], catalogItemId: string, qty: number, extra?: { locationLabel?: string; accessoryCatalogItemId?: string | null; accessoryQty?: number }) => void;
  onUpdateLocationItem: (locationId: string, itemId: string, updates: Partial<{ qty: number; locationLabel: string; accessoryCatalogItemId: string | null; accessoryQty: number }>) => void;
  onDeleteLocationItem: (locationId: string, itemId: string) => void;
  onUploadImage: (
    locationId: string,
    imageType: "photo" | "drawing",
    file: File,
    description?: string,
    coords?: { lat: number; lng: number } | null,
  ) => Promise<boolean>;
  onDownloadImage: (image: ProjectLocationImage) => void;
  onDeleteImage: (locationId: string, imageId: string, storagePath: string) => Promise<boolean>;
  onGetImageUrl: (image: ProjectLocationImage) => Promise<string | null>;
  onUpdateImageDescription: (locationId: string, imageId: string, description: string) => void;
  onUpdateImageMeta: (locationId: string, imageId: string, updates: { fileName: string; description: string }) => Promise<boolean>;
  onMoveImage: (fromLocationId: string, imageId: string, targetLocationId: string) => Promise<boolean>;
}) {
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [cameraLocationId, setCameraLocationId] = useState<string | null>(null);
  const [filesLocationId, setFilesLocationId] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const emptyLineDraft = { catalogItemId: "", qty: 1, locationLabel: "", accessoryCatalogItemId: "", accessoryQty: 0 };
  const [cameraItemDraft, setCameraItemDraft] = useState(emptyLineDraft);
  const [signItemDraft, setSignItemDraft] = useState(emptyLineDraft);
  const [sensorItemDraft, setSensorItemDraft] = useState(emptyLineDraft);
  const [miscItemDraft, setMiscItemDraft] = useState(emptyLineDraft);

  const locations = project.locations ?? [];
  const selectedLocation = locations.find((location) => location.id === selectedLocationId) ?? null;
  const activeCatalogItems = catalogItems.filter((item) => !item.isRetired);
  const cameraCatalogItems = activeCatalogItems.filter((item) => item.category === "Cameras");
  const signCatalogItems = activeCatalogItems.filter((item) => item.category === "Signage");
  const sensorCatalogItems = activeCatalogItems.filter(
    (item) => item.category === "Space Sensors" || (item.tags ?? []).some((tag) => tag.toLowerCase().includes("sensor")),
  );
  const hasTag = (item: CatalogItem, tag: string) => (item.tags ?? []).some((entry) => entry.trim().toLowerCase() === tag);
  const cameraAccessoryCatalogItems = activeCatalogItems.filter((item) => hasTag(item, "camera accessory"));
  const signAccessoryCatalogItems = activeCatalogItems.filter((item) => hasTag(item, "sign accessory"));
  const sensorAccessoryCatalogItems = activeCatalogItems.filter((item) => hasTag(item, "sensor accessory"));

  return (
    <section className="panel wide">
      <div className="panel-title-row">
        <div>
          <h2>Locations</h2>
          <p>Same per-garage/lot breakdown as Sales -- photos and drawings carry through implementation to closeout.</p>
        </div>
        <div className="quote-header-pill-row">
          <button className="secondary-action mini-action mini-action-sm" type="button" onClick={() => onAddLocation("garage")}>+ Garage</button>
          <button className="secondary-action mini-action mini-action-sm" type="button" onClick={() => onAddLocation("lot")}>+ Lot</button>
          <button className="secondary-action mini-action mini-action-sm" type="button" onClick={() => setShowGallery(true)}>Site Gallery</button>
        </div>
      </div>

      <table className="stack-table-mobile">
        <thead>
          <tr><th>Type</th><th>Name</th><th>Photos</th><th>Files</th><th></th></tr>
        </thead>
        <tbody>
          {locations.map((location) => {
            const photoCount = location.images.filter((image) => image.imageType === "photo").length;
            const drawingCount = location.images.filter((image) => image.imageType === "drawing").length;
            return (
              <tr key={location.id} className="clickable-row" onClick={() => setSelectedLocationId(location.id)}>
                <td><span className={`status ${location.locationType === "garage" ? "ok" : ""}`}>{location.locationType === "garage" ? "Garage" : "Lot"}</span></td>
                <td>
                  <input
                    className="quote-location-row-name"
                    value={location.name}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => onUpdateLocation(location.id, { name: event.target.value })}
                    placeholder={location.locationType === "garage" ? "Garage name" : "Lot name"}
                  />
                </td>
                <td>
                  <button
                    className="icon-count-button"
                    type="button"
                    title="Take Photos"
                    onClick={(event) => {
                      event.stopPropagation();
                      setCameraLocationId(location.id);
                    }}
                  >
                    <Camera size={16} /><span>{photoCount}</span>
                  </button>
                </td>
                <td>
                  <button
                    className="icon-count-button"
                    type="button"
                    title="View files"
                    onClick={(event) => {
                      event.stopPropagation();
                      setFilesLocationId(location.id);
                    }}
                  >
                    <FileText size={16} /><span>{drawingCount}</span>
                  </button>
                </td>
                <td className="row-delete-cell">
                  <button
                    className="icon-button compact-remove row-delete-btn"
                    type="button"
                    title={`Delete ${location.locationType === "garage" ? "garage" : "lot"}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (window.confirm(`Delete "${location.name || (location.locationType === "garage" ? "this garage" : "this lot")}"? Its photos, files, and hardware line items go with it. This can't be undone.`)) {
                        onDeleteLocation(location.id);
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            );
          })}
          {locations.length === 0 && (
            <tr><td colSpan={5} className="empty-compact-state">No garages or lots yet -- use + Garage / + Lot, or convert a Closed - Won Sales Quote to pull them in.</td></tr>
          )}
        </tbody>
      </table>

      {selectedLocation && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="project-location-title">
            <div className="modal-header">
              <div>
                <h2 id="project-location-title">{selectedLocation.name || (selectedLocation.locationType === "garage" ? "Garage" : "Lot")}</h2>
                <p>Site details for this garage/lot.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setSelectedLocationId(null)} aria-label="Close location details">x</button>
            </div>
            <div className="bom-modal-grid">
              <label className="span-2">Address<input value={selectedLocation.address} onChange={(event) => onUpdateLocation(selectedLocation.id, { address: event.target.value })} placeholder="This garage/lot's own address, if different from the client address" /></label>
              <p className="span-2 muted">General info for reference only -- doesn't drive anything below. Actual camera hardware is picked in the Cameras section.</p>
              <label className="checkbox-inline">
                <input type="checkbox" checked={selectedLocation.fli} onChange={(event) => onUpdateLocation(selectedLocation.id, { fli: event.target.checked })} /> FLI
              </label>
              <label className="checkbox-inline">
                <input type="checkbox" checked={selectedLocation.lpr} onChange={(event) => onUpdateLocation(selectedLocation.id, { lpr: event.target.checked })} /> LPR
              </label>
              <label className="checkbox-inline">
                <input type="checkbox" checked={selectedLocation.peopleCounting} onChange={(event) => onUpdateLocation(selectedLocation.id, { peopleCounting: event.target.checked })} /> People counting
              </label>
              <label>Entries<input className="qty-input-narrow" type="number" min={0} max={999} value={selectedLocation.entriesCount} onChange={(event) => onUpdateLocation(selectedLocation.id, { entriesCount: Number(event.target.value) || 0 })} /></label>
              <label>Exits<input className="qty-input-narrow" type="number" min={0} max={999} value={selectedLocation.exitsCount} onChange={(event) => onUpdateLocation(selectedLocation.id, { exitsCount: Number(event.target.value) || 0 })} /></label>
              <label>Levels<input className="qty-input-narrow" type="number" min={0} max={999} value={selectedLocation.levelsCount} onChange={(event) => onUpdateLocation(selectedLocation.id, { levelsCount: Number(event.target.value) || 0 })} /></label>
            </div>

            <LocationItemLineSection
              title="Cameras"
              hint="Cameras for this facility, pulled straight from the Product Catalog."
              items={selectedLocation.cameraLines}
              catalogItems={catalogItems}
              options={cameraCatalogItems}
              accessoryOptions={cameraAccessoryCatalogItems}
              draft={cameraItemDraft}
              onDraftChange={setCameraItemDraft}
              onAdd={() => {
                onAddLocationItem(selectedLocation.id, "camera", cameraItemDraft.catalogItemId, cameraItemDraft.qty, {
                  locationLabel: cameraItemDraft.locationLabel,
                  accessoryCatalogItemId: cameraItemDraft.accessoryCatalogItemId || null,
                  accessoryQty: cameraItemDraft.accessoryQty,
                });
                setCameraItemDraft(emptyLineDraft);
              }}
              onUpdateItem={(itemId, updates) => onUpdateLocationItem(selectedLocation.id, itemId, updates)}
              onDelete={(itemId) => onDeleteLocationItem(selectedLocation.id, itemId)}
            />

            <LocationItemLineSection
              title="Signs"
              hint="Signage for this facility, pulled straight from the Product Catalog."
              items={selectedLocation.signLines}
              catalogItems={catalogItems}
              options={signCatalogItems}
              accessoryOptions={signAccessoryCatalogItems}
              draft={signItemDraft}
              onDraftChange={setSignItemDraft}
              onAdd={() => {
                onAddLocationItem(selectedLocation.id, "sign", signItemDraft.catalogItemId, signItemDraft.qty, {
                  locationLabel: signItemDraft.locationLabel,
                  accessoryCatalogItemId: signItemDraft.accessoryCatalogItemId || null,
                  accessoryQty: signItemDraft.accessoryQty,
                });
                setSignItemDraft(emptyLineDraft);
              }}
              onUpdateItem={(itemId, updates) => onUpdateLocationItem(selectedLocation.id, itemId, updates)}
              onDelete={(itemId) => onDeleteLocationItem(selectedLocation.id, itemId)}
            />

            <LocationItemLineSection
              title="Space Sensor"
              hint="Sensors for this facility -- catalog items tagged sensor or filed under the Space Sensors category."
              items={selectedLocation.sensorLines}
              catalogItems={catalogItems}
              options={sensorCatalogItems}
              accessoryOptions={sensorAccessoryCatalogItems}
              draft={sensorItemDraft}
              onDraftChange={setSensorItemDraft}
              onAdd={() => {
                onAddLocationItem(selectedLocation.id, "sensor", sensorItemDraft.catalogItemId, sensorItemDraft.qty, {
                  locationLabel: sensorItemDraft.locationLabel,
                  accessoryCatalogItemId: sensorItemDraft.accessoryCatalogItemId || null,
                  accessoryQty: sensorItemDraft.accessoryQty,
                });
                setSensorItemDraft(emptyLineDraft);
              }}
              onUpdateItem={(itemId, updates) => onUpdateLocationItem(selectedLocation.id, itemId, updates)}
              onDelete={(itemId) => onDeleteLocationItem(selectedLocation.id, itemId)}
            />

            <LocationItemLineSection
              title="Misc."
              hint="Anything else for this facility -- the whole Product Catalog is available here."
              items={selectedLocation.miscLines}
              catalogItems={catalogItems}
              options={activeCatalogItems}
              accessoryOptions={activeCatalogItems}
              draft={miscItemDraft}
              onDraftChange={setMiscItemDraft}
              onAdd={() => {
                onAddLocationItem(selectedLocation.id, "misc", miscItemDraft.catalogItemId, miscItemDraft.qty, {
                  locationLabel: miscItemDraft.locationLabel,
                  accessoryCatalogItemId: miscItemDraft.accessoryCatalogItemId || null,
                  accessoryQty: miscItemDraft.accessoryQty,
                });
                setMiscItemDraft(emptyLineDraft);
              }}
              onUpdateItem={(itemId, updates) => onUpdateLocationItem(selectedLocation.id, itemId, updates)}
              onDelete={(itemId) => onDeleteLocationItem(selectedLocation.id, itemId)}
            />

            {selectedLocation.images.length > 0 && (
              <div className="line-list">
                {selectedLocation.images.map((image) => (
                  <div className="line-item quote-image-line-item" key={image.id}>
                    <div>
                      <strong>{image.fileName || (image.imageType === "photo" ? "Photo" : "Drawing")}</strong>
                      <span>{image.imageType === "photo" ? "Photo" : "Drawing"}</span>
                      {image.imageType === "photo" && (
                        <input
                          className="quote-image-description-input"
                          value={image.description}
                          placeholder="Description (optional)"
                          onChange={(event) => onUpdateImageDescription(selectedLocation.id, image.id, event.target.value)}
                        />
                      )}
                      <small className="muted">{formatImageProvenance(image)}</small>
                    </div>
                    <button className="secondary-action mini-action" type="button" onClick={() => onDownloadImage(image)}>Download</button>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setSelectedLocationId(null)}>Close</button>
            </div>
          </section>
        </div>
      )}

      {cameraLocationId && (
        <CameraCaptureModal
          quoteId={project.ref}
          locationId={cameraLocationId}
          locationName={locations.find((location) => location.id === cameraLocationId)?.name || "this location"}
          ownerType="project"
          onClose={() => setCameraLocationId(null)}
          onSavePhoto={(file, description, coords) => onUploadImage(cameraLocationId, "photo", file, description, coords)}
        />
      )}

      {filesLocationId && (
        <LocationFilesModal
          locationName={locations.find((location) => location.id === filesLocationId)?.name || "this location"}
          locationId={filesLocationId}
          locations={locations}
          files={locations.find((location) => location.id === filesLocationId)?.images.filter((image) => image.imageType === "drawing") ?? []}
          onUpload={(file) => onUploadImage(filesLocationId, "drawing", file)}
          onDownload={onDownloadImage}
          onDelete={(image) => onDeleteImage(filesLocationId, image.id, image.storagePath)}
          onGetUrl={onGetImageUrl}
          onUpdate={(image, updates) => onUpdateImageMeta(filesLocationId, image.id, updates)}
          onMove={(image, targetLocationId) => onMoveImage(filesLocationId, image.id, targetLocationId)}
          onClose={() => setFilesLocationId(null)}
        />
      )}

      {showGallery && (
        <SiteGalleryModal
          siteName={project.name}
          locations={locations}
          onGetUrl={onGetImageUrl}
          onUpdate={(locationId, image, updates) => onUpdateImageMeta(locationId, image.id, updates)}
          onMove={(locationId, image, targetLocationId) => onMoveImage(locationId, image.id, targetLocationId)}
          onDelete={(locationId, image) => onDeleteImage(locationId, image.id, image.storagePath)}
          onClose={() => setShowGallery(false)}
        />
      )}
    </section>
  );
}

type SiteContactFieldsValues = {
  siteName: string;
  city: string;
  siteStreetAddress: string;
  siteState: string;
  siteZip: string;
  clientName: string;
  clientStreetAddress: string;
  clientCity: string;
  clientState: string;
  clientZip: string;
  contactFullName: string;
  clientEmail: string;
  contactPhone: string;
  preferredCommunication: string;
};

// #179-184 -- E flagged that the New/Edit Site sheet and the top of the
// Site Intake Questionnaire were asking for overlapping info in
// inconsistent, unsectioned layouts. This is the one shared "Site /
// Company / Contact" form used by both, so there's exactly one place that
// defines what's asked and how it's grouped -- New Site (garage/lot counts
// editable, since they drive initial location creation), Edit Site and the
// Intake modal (garage/lot counts read-only reference, since changing them
// there doesn't map to real named locations -- use + Garage/+ Lot instead).
function SiteContactFields({
  values,
  onChange,
  garageCount,
  lotCount,
  onGarageCountChange,
  onLotCountChange,
}: {
  values: SiteContactFieldsValues;
  onChange: (patch: Partial<SiteContactFieldsValues>) => void;
  garageCount: number;
  lotCount: number;
  onGarageCountChange?: (value: number) => void;
  onLotCountChange?: (value: number) => void;
}) {
  const garageLotEditable = Boolean(onGarageCountChange && onLotCountChange);
  return (
    <>
      <div className="modal-section">
        <span className="modal-section-title">Site Information</span>
        <div className="tight-form-rows">
          <div className="tight-form-row">
            <label className="tight-field tight-field-wide"><span>Site name</span><input value={values.siteName} onChange={(event) => onChange({ siteName: event.target.value })} placeholder="Site name" /></label>
            <label className="tight-field tight-field-wide"><span>Street Address</span><input value={values.siteStreetAddress} onChange={(event) => onChange({ siteStreetAddress: event.target.value })} placeholder="Street address" /></label>
          </div>
          <div className="tight-form-row">
            <label className="tight-field tight-field-medium"><span>City</span><input value={values.city} onChange={(event) => onChange({ city: event.target.value })} placeholder="City" /></label>
            <label className="tight-field tight-field-tiny"><span>State</span><input value={values.siteState} onChange={(event) => onChange({ siteState: event.target.value })} placeholder="State" /></label>
            <label className="tight-field tight-field-tiny"><span>Zip</span><input value={values.siteZip} onChange={(event) => onChange({ siteZip: event.target.value })} placeholder="Zip" maxLength={7} /></label>
          </div>
          <div className="tight-form-row">
            <label className="tight-field tight-field-tiny">
              <span>Garages</span>
              <input
                type="number"
                min={0}
                maxLength={3}
                value={garageCount}
                disabled={!garageLotEditable}
                onChange={(event) => onGarageCountChange?.(Number(event.target.value) || 0)}
              />
            </label>
            <label className="tight-field tight-field-tiny">
              <span>Parking lots</span>
              <input
                type="number"
                min={0}
                maxLength={3}
                value={lotCount}
                disabled={!garageLotEditable}
                onChange={(event) => onLotCountChange?.(Number(event.target.value) || 0)}
              />
            </label>
            {!garageLotEditable && <span className="field-hint">Use the + Garage / + Lot buttons on the site page to add more locations.</span>}
          </div>
        </div>
      </div>

      <div className="modal-section">
        <span className="modal-section-title">Company Information</span>
        <div className="tight-form-rows">
          <div className="tight-form-row">
            <label className="tight-field tight-field-wide"><span>Company Name</span><input value={values.clientName} onChange={(event) => onChange({ clientName: event.target.value })} placeholder="Company Name" /></label>
            <label className="tight-field tight-field-wide"><span>Street Address</span><input value={values.clientStreetAddress} onChange={(event) => onChange({ clientStreetAddress: event.target.value })} placeholder="Street address" /></label>
          </div>
          <div className="tight-form-row">
            <label className="tight-field tight-field-medium"><span>City</span><input value={values.clientCity} onChange={(event) => onChange({ clientCity: event.target.value })} placeholder="City" /></label>
            <label className="tight-field tight-field-tiny"><span>State</span><input value={values.clientState} onChange={(event) => onChange({ clientState: event.target.value })} placeholder="State" /></label>
            <label className="tight-field tight-field-tiny"><span>Zip</span><input value={values.clientZip} onChange={(event) => onChange({ clientZip: event.target.value })} placeholder="Zip" maxLength={7} /></label>
          </div>
        </div>
      </div>

      <div className="modal-section">
        <span className="modal-section-title">Contact Information</span>
        <div className="tight-form-rows">
          <div className="tight-form-row">
            <label className="tight-field tight-field-medium"><span>Full Name</span><input value={values.contactFullName} onChange={(event) => onChange({ contactFullName: event.target.value })} placeholder="Full name" /></label>
            <label className="tight-field tight-field-wide"><span>Business Email</span><input value={values.clientEmail} onChange={(event) => onChange({ clientEmail: event.target.value })} placeholder="Business email" /></label>
          </div>
          <div className="tight-form-row">
            <label className="tight-field tight-field-medium"><span>Phone Number</span><input value={values.contactPhone} onChange={(event) => onChange({ contactPhone: event.target.value })} placeholder="Phone number" /></label>
            <label className="tight-field tight-field-medium">
              <span>Preferred Communication</span>
              <select value={values.preferredCommunication} onChange={(event) => onChange({ preferredCommunication: event.target.value })}>
                <option value="">Select...</option>
                <option value="Email">Email</option>
                <option value="Phone Call">Phone Call</option>
                <option value="Video Meeting (Zoom/Teams)">Video Meeting (Zoom/Teams)</option>
              </select>
            </label>
          </div>
        </div>
      </div>
    </>
  );
}

function SalesQuoteBuilder({
  salesQuotes,
  status,
  isConfigured,
  onCreateQuote,
  onAddLocation,
  onUpdateLocation,
  onDeleteLocation,
  onAddLocationItem,
  onUpdateLocationItem,
  onDeleteLocationItem,
  onPullLocationHardware,
  onUpdateStatus,
  onDeleteQuote,
  onCreateProjectFromClosedWonQuote,
  onAddBomLines,
  onDeleteBomLine,
  onUpdateBomLineCatalogLink,
  onUpdateProposalFields,
  onUpdateQuoteInfo,
  siteIntakeSchema,
  quoteIntakeResponses,
  quoteIntakeStatus,
  onLoadQuoteIntakeResponse,
  onSaveQuoteIntakeResponses,
  quoteProposals,
  quoteProposalStatus,
  onLoadQuoteProposals,
  onCreateQuoteProposal,
  presalesRules,
  presalesStatus,
  onGenerateBaselineBom,
  catalogItems,
  onUploadImage,
  onUpdateImageDescription,
  onDownloadImage,
  onDeleteImage,
  onGetImageUrl,
  onUpdateImageMeta,
  onMoveImage,
  siteHardwareRules,
  projectSites,
  tasks,
  teamMembers,
  onCreateTask,
}: {
  salesQuotes: SalesQuote[];
  status: string;
  isConfigured: boolean;
  onCreateQuote: (input: NewSiteInput) => void;
  onAddLocation: (quoteId: string, locationType: "garage" | "lot") => void;
  onUpdateLocation: (
    quoteId: string,
    locationId: string,
    updates: Partial<{
      name: string;
      address: string;
      fli: boolean;
      lpr: boolean;
      peopleCounting: boolean;
      fliCameraItemId: string | null;
      lprCameraItemId: string | null;
      peopleCountingCameraItemId: string | null;
      entriesCount: number;
      exitsCount: number;
      levelsCount: number;
    }>,
  ) => void;
  onDeleteLocation: (quoteId: string, locationId: string) => void;
  onAddLocationItem: (quoteId: string, locationId: string, lineType: SalesQuoteLocationItem["lineType"], catalogItemId: string, qty: number, extra?: { locationLabel?: string; accessoryCatalogItemId?: string | null; accessoryQty?: number }) => void;
  onUpdateLocationItem: (quoteId: string, locationId: string, itemId: string, updates: Partial<{ qty: number; locationLabel: string; accessoryCatalogItemId: string | null; accessoryQty: number }>) => void;
  onDeleteLocationItem: (quoteId: string, locationId: string, itemId: string) => void;
  onPullLocationHardware: (quoteId: string) => void;
  onUpdateStatus: (quoteId: string, status: SalesQuote["status"]) => void;
  onDeleteQuote: (quoteId: string) => void;
  onCreateProjectFromClosedWonQuote: (quote: SalesQuote) => Promise<ProjectSite | null>;
  onAddBomLines: (quoteId: string, lines: Array<{ item: string; qty: number; notes?: string; catalogItemId?: string | null }>) => void;
  onDeleteBomLine: (quoteId: string, lineId: string) => void;
  onUpdateBomLineCatalogLink: (quoteId: string, lineId: string, catalogItemId: string | null) => void;
  onUpdateProposalFields: (quoteId: string, updates: Partial<{ clientEmail: string; proposalSummary: string }>) => void;
  onUpdateQuoteInfo: (
    quoteId: string,
    updates: Partial<{
      clientName: string;
      siteName: string;
      city: string;
      clientEmail: string;
      contactFullName: string;
      contactPhone: string;
      preferredCommunication: string;
      saasType: string;
      saasContractAmount: number | null;
      saasBillingFrequency: SalesQuote["saasBillingFrequency"];
    }>,
  ) => void;
  siteIntakeSchema: FormSchema | null;
  quoteIntakeResponses: Record<string, SalesQuoteIntakeResponse>;
  quoteIntakeStatus: string;
  onLoadQuoteIntakeResponse: (quoteId: string) => void;
  onSaveQuoteIntakeResponses: (quoteId: string, responses: Record<string, string>) => void;
  quoteProposals: SalesQuoteProposal[];
  quoteProposalStatus: string;
  onLoadQuoteProposals: (quoteId: string) => void;
  onCreateQuoteProposal: (quote: SalesQuote) => void;
  presalesRules: PresalesHardwareRule[];
  presalesStatus: string;
  onGenerateBaselineBom: (quoteId: string, tier: string, nodeCount: number, cloudSync: boolean) => void;
  catalogItems: CatalogItem[];
  onUploadImage: (
    quoteId: string,
    locationId: string,
    imageType: "photo" | "drawing",
    file: File,
    description?: string,
    coords?: { lat: number; lng: number } | null,
  ) => Promise<boolean>;
  onUpdateImageDescription: (quoteId: string, locationId: string, imageId: string, description: string) => void;
  onUpdateImageMeta: (quoteId: string, locationId: string, imageId: string, updates: { fileName: string; description: string }) => Promise<boolean>;
  onMoveImage: (quoteId: string, fromLocationId: string, imageId: string, targetLocationId: string) => Promise<boolean>;
  onDownloadImage: (image: SalesQuoteLocationImage) => void;
  onDeleteImage: (quoteId: string, locationId: string, imageId: string, storagePath: string) => Promise<boolean>;
  onGetImageUrl: (image: SalesQuoteLocationImage) => Promise<string | null>;
  siteHardwareRules: SiteHardwareRule[];
  projectSites: ProjectSite[];
  tasks: EOTask[];
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"list" | "detail">("list");
  const [cameraLocationId, setCameraLocationId] = useState<string | null>(null);
  const [filesLocationId, setFilesLocationId] = useState<string | null>(null);
  const [showSiteGallery, setShowSiteGallery] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [showNewQuoteModal, setShowNewQuoteModal] = useState(false);
  const [newQuoteDraft, setNewQuoteDraft] = useState(EMPTY_NEW_QUOTE_DRAFT);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectCreateStatus, setProjectCreateStatus] = useState("");
  const [isCollapsed, setIsCollapsed] = usePersistedCollapse("site_builder");
  const [presalesTier, setPresalesTier] = useState("");
  const [presalesNodeCount, setPresalesNodeCount] = useState(1);
  const [presalesCloudSync, setPresalesCloudSync] = useState(false);
  const [bomLineDraft, setBomLineDraft] = useState({ item: "", qty: 1, notes: "", catalogItemId: "" });
  const [proposalClientEmailDraft, setProposalClientEmailDraft] = useState("");
  const [proposalSummaryDraft, setProposalSummaryDraft] = useState("");
  const [copiedProposalId, setCopiedProposalId] = useState("");
  // Migration 056: addable Camera/Sign/Space Sensor/Misc lines at the
  // location level -- one small draft per section, reset after each add.
  const emptyLineDraft = { catalogItemId: "", qty: 1, locationLabel: "", accessoryCatalogItemId: "", accessoryQty: 0 };
  const [cameraItemDraft, setCameraItemDraft] = useState(emptyLineDraft);
  const [signItemDraft, setSignItemDraft] = useState(emptyLineDraft);
  const [sensorItemDraft, setSensorItemDraft] = useState(emptyLineDraft);
  const [miscItemDraft, setMiscItemDraft] = useState(emptyLineDraft);
  // #164 -- lets a rep get back to the original "New Site" intake fields
  // (client/site name, city) and correct them after the quote already
  // exists.
  const [isEditingSiteInfo, setIsEditingSiteInfo] = useState(false);
  const [siteInfoDraft, setSiteInfoDraft] = useState<SiteContactFieldsValues>({
    clientName: "",
    siteName: "",
    city: "",
    contactFullName: "",
    clientEmail: "",
    contactPhone: "",
    preferredCommunication: "",
    siteStreetAddress: "",
    siteState: "",
    siteZip: "",
    clientStreetAddress: "",
    clientCity: "",
    clientState: "",
    clientZip: "",
  });
  // Migration 073: the actual signed SaaS contract terms -- carries over
  // to the Project once this quote closes.
  const [saasDraft, setSaasDraft] = useState<{ saasType: string; saasContractAmount: number | null; saasBillingFrequency: SalesQuote["saasBillingFrequency"] }>({
    saasType: "",
    saasContractAmount: null,
    saasBillingFrequency: "",
  });
  // #168 -- the Site Intake Questionnaire used to render fully expanded
  // inline (a lot of scrolling on a long site); now it's a compact trigger
  // that opens a pop-up, same pattern as the Edit Site modal above.
  const [showIntakeModal, setShowIntakeModal] = useState(false);

  const selectedQuote = salesQuotes.find((quote) => quote.id === selectedQuoteId) ?? null;
  const selectedLocation = selectedQuote?.locations.find((location) => location.id === selectedLocationId) ?? null;
  // Same idea as Admin -> Pre-Sales Rules: categories come straight from the
  // Product Catalog instead of a freeform typed tier.
  const catalogCategories = Array.from(new Set(catalogItems.map((item) => item.category.trim()).filter(Boolean))).sort();
  const activeCatalogItems = catalogItems.filter((item) => !item.isRetired);
  // Camera model picker for FLI/LPR/People Counting -- narrowed to the
  // Cameras category, since these are specifically "which camera model."
  const cameraCatalogItems = activeCatalogItems.filter((item) => item.category === "Cameras");
  // Signs section: catalog items categorized as Signage.
  const signCatalogItems = activeCatalogItems.filter((item) => item.category === "Signage");
  // Space Sensor section: E asked for a real Category (Space Sensors,
  // added to CATALOG_CATEGORY_OPTIONS above) but also mentioned tags --
  // matching on either covers items that predate the new category and
  // only have the free-text tag set.
  const sensorCatalogItems = activeCatalogItems.filter(
    (item) => item.category === "Space Sensors" || (item.tags ?? []).some((tag) => tag.toLowerCase().includes("sensor")),
  );
  const hasTag = (item: CatalogItem, tag: string) => (item.tags ?? []).some((entry) => entry.trim().toLowerCase() === tag);
  const cameraAccessoryCatalogItems = activeCatalogItems.filter((item) => hasTag(item, "camera accessory"));
  const signAccessoryCatalogItems = activeCatalogItems.filter((item) => hasTag(item, "sign accessory"));
  const sensorAccessoryCatalogItems = activeCatalogItems.filter((item) => hasTag(item, "sensor accessory"));
  // Small "x/y answered" hint on the compact Site Intake Questionnaire
  // trigger button (#168) -- lets a rep see progress without opening it.
  const siteIntakeResponses = selectedQuote ? quoteIntakeResponses[selectedQuote.id]?.responses ?? {} : {};
  const siteIntakeFieldCount = siteIntakeSchema?.fields.length ?? 0;
  const siteIntakeAnsweredCount = (siteIntakeSchema?.fields ?? []).filter((field) => (siteIntakeResponses[field.fieldKey] ?? "").toString().trim() !== "").length;

  useEffect(() => {
    if (selectedQuoteId) {
      onLoadQuoteProposals(selectedQuoteId);
      onLoadQuoteIntakeResponse(selectedQuoteId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuoteId]);

  useEffect(() => {
    setProposalClientEmailDraft(selectedQuote?.clientEmail ?? "");
    setProposalSummaryDraft(selectedQuote?.proposalSummary ?? "");
  }, [selectedQuote?.id, selectedQuote?.clientEmail, selectedQuote?.proposalSummary]);

  useEffect(() => {
    setIsEditingSiteInfo(false);
    setSiteInfoDraft({
      clientName: selectedQuote?.clientName ?? "",
      siteName: selectedQuote?.siteName ?? "",
      city: selectedQuote?.city ?? "",
      contactFullName: selectedQuote?.contactFullName ?? "",
      clientEmail: selectedQuote?.clientEmail ?? "",
      contactPhone: selectedQuote?.contactPhone ?? "",
      preferredCommunication: selectedQuote?.preferredCommunication ?? "",
      siteStreetAddress: selectedQuote?.siteStreetAddress ?? "",
      siteState: selectedQuote?.siteState ?? "",
      siteZip: selectedQuote?.siteZip ?? "",
      clientStreetAddress: selectedQuote?.clientStreetAddress ?? "",
      clientCity: selectedQuote?.clientCity ?? "",
      clientState: selectedQuote?.clientState ?? "",
      clientZip: selectedQuote?.clientZip ?? "",
    });
    setSaasDraft({
      saasType: selectedQuote?.saasType ?? "",
      saasContractAmount: selectedQuote?.saasContractAmount ?? null,
      saasBillingFrequency: selectedQuote?.saasBillingFrequency ?? "",
    });
  }, [selectedQuote]);

  function openQuote(id: string) {
    setSelectedQuoteId(id);
    setMode("detail");
  }

  function backToList() {
    setMode("list");
    setSelectedLocationId(null);
  }

  // E's request: closing a deal should offer to spin up a Project that
  // starts with everything the quote already has -- contact info, BOM, and
  // the full per-garage/lot breakdown including photos/drawings -- in the
  // same format, so media can be tracked from presale through closeout.
  // Split from the status-change trigger below so there's also a manual
  // "Create Project" button -- if the confirm gets dismissed, or the
  // creation attempt fails (e.g. a network hiccup, or hitting Closed - Won
  // before a backend migration had finished rolling out), there's a visible
  // way to retry instead of having to flip the status back to Open and Won
  // again to re-trigger the prompt.
  async function runCreateProjectFromQuote(quote: SalesQuote) {
    setIsCreatingProject(true);
    setProjectCreateStatus("Creating project...");
    const created = await onCreateProjectFromClosedWonQuote(quote);
    setIsCreatingProject(false);
    if (created) {
      setProjectCreateStatus(`Created Project "${created.name}" (${created.ref || "no ref yet"}) -- find it on the Projects page.`);
    } else {
      const message = "Could not create the project -- check your connection and that you're signed in, then try Create Project again. If it keeps happening, check the browser console for details.";
      setProjectCreateStatus(message);
      window.alert(message);
    }
  }

  async function handleStatusChange(quote: SalesQuote, nextStatus: SalesQuote["status"]) {
    onUpdateStatus(quote.id, nextStatus);
    if (nextStatus !== "closed_won") {
      return;
    }
    const wantsProject = window.confirm(`Create a new Project from "${quote.siteName}"? This copies the contact info, BOM, and every garage/lot -- including photos and drawings -- into a new Project you can find on the Projects page.`);
    if (!wantsProject) {
      return;
    }
    await runCreateProjectFromQuote(quote);
  }

  function submitNewQuote() {
    if (!newQuoteDraft.clientName.trim() || !newQuoteDraft.siteName.trim()) {
      return;
    }
    onCreateQuote(newQuoteDraft);
    setNewQuoteDraft(EMPTY_NEW_QUOTE_DRAFT);
    setShowNewQuoteModal(false);
  }

  function saveSiteInfo() {
    if (!selectedQuote || !siteInfoDraft.clientName.trim() || !siteInfoDraft.siteName.trim()) {
      return;
    }
    onUpdateQuoteInfo(selectedQuote.id, { ...siteInfoDraft, ...saasDraft });
    setIsEditingSiteInfo(false);
  }

  return (
    <>
      {mode === "list" && (
        <section className="panel wide">
          <div className="panel-title-row">
            <div>
              <h2>Site Builder</h2>
              <p>Scope a client's garages and parking lots, then build a hardware quote.</p>
            </div>
            <div className="action-row">
              <button className="primary-action mini-action" type="button" onClick={() => setShowNewQuoteModal(true)} disabled={!isConfigured}>
                <Plus size={14} /> New Site
              </button>
              <button className="icon-button" type="button" onClick={() => setIsCollapsed((current) => !current)} aria-label={isCollapsed ? "Expand section" : "Collapse section"}>
                {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </button>
            </div>
          </div>
          {!isCollapsed && (
            <>
              {!isConfigured && <span className="muted">Set Supabase env vars to manage quotes.</span>}
              {status && <small className="muted">{status}</small>}
              <div className="site-builder-table-scroll">
              <table>
                <thead>
                  <tr><th>Name</th><th>City</th><th>Sales Person</th><th>Locations</th><th>Status</th><th>Tasks</th><th></th></tr>
                </thead>
                <tbody>
                  {salesQuotes.map((quote) => {
                    const quoteTasks = tasks.filter((task) => task.quoteId === quote.id);
                    const openCount = quoteTasks.filter((task) => task.status !== "done").length;
                    const taskPillClass = quoteTasks.length === 0 ? "status-pill" : openCount > 0 ? "status-pill status-blocked" : "status-pill status-done";
                    const taskPillLabel = quoteTasks.length === 0 ? "No tasks" : openCount > 0 ? `${openCount} open` : "All done";
                    return (
                      <tr key={quote.id} className="table-row-clickable" onClick={() => openQuote(quote.id)}>
                        <td>{quote.quoteRef && <small className="quote-ref-tag">{quote.quoteRef}</small>}<strong>{quote.siteName}</strong><small>{quote.clientName}</small></td>
                        <td>{quote.city || "-"}</td>
                        <td>{quote.createdByEmail ? assigneeLabel(quote.createdByEmail, teamMembers) : "-"}</td>
                        <td>{quote.locations.length}</td>
                        <td><span className={`status ${quote.status === "closed_won" ? "ok" : quote.status === "closed_lost" ? "" : "warn"}`}>{quote.status === "closed_won" ? "Closed - Won" : quote.status === "closed_lost" ? "Closed - Lost" : "Open"}</span></td>
                        <td><span className={taskPillClass}>{taskPillLabel}</span></td>
                        <td className="row-delete-cell">
                          <button
                            className="icon-button compact-remove row-delete-btn"
                            type="button"
                            title="Delete site"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (window.confirm(`Delete "${quote.siteName}"? This removes all of its garages/lots, photos, files, and BOM lines, and unlinks (but doesn't delete) any tasks tied to it. This can't be undone.`)) {
                                onDeleteQuote(quote.id);
                              }
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {salesQuotes.length === 0 && (
                    <tr><td colSpan={7} className="empty-compact-state">No sites yet. New Site to start scoping one.</td></tr>
                  )}
                </tbody>
              </table>
              </div>

              <div className="site-builder-mobile-list">
                {salesQuotes.map((quote) => {
                  const quoteTasks = tasks.filter((task) => task.quoteId === quote.id);
                  const openCount = quoteTasks.filter((task) => task.status !== "done").length;
                  const taskPillClass = quoteTasks.length === 0 ? "status-pill" : openCount > 0 ? "status-pill status-blocked" : "status-pill status-done";
                  const taskPillLabel = quoteTasks.length === 0 ? "No tasks" : openCount > 0 ? `${openCount} open` : "All done";
                  return (
                    <button key={quote.id} type="button" className="site-builder-mobile-card" onClick={() => openQuote(quote.id)}>
                      <span className="site-builder-mobile-card-title-row">
                        <span>
                          {quote.quoteRef && <small className="quote-ref-tag">{quote.quoteRef}</small>}
                          <strong>{quote.siteName}</strong>
                          <small className="muted">{quote.clientName}</small>
                        </span>
                        <button
                          className="icon-button compact-remove"
                          type="button"
                          title="Delete site"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (window.confirm(`Delete "${quote.siteName}"? This removes all of its garages/lots, photos, files, and BOM lines, and unlinks (but doesn't delete) any tasks tied to it. This can't be undone.`)) {
                              onDeleteQuote(quote.id);
                            }
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </span>
                      <span className="site-builder-mobile-card-meta">{quote.city || "No city"} &middot; {quote.createdByEmail ? assigneeLabel(quote.createdByEmail, teamMembers) : "Unassigned"} &middot; {quote.locations.length} location(s)</span>
                      <span className="site-builder-mobile-card-pills">
                        <span className={`status ${quote.status === "closed_won" ? "ok" : quote.status === "closed_lost" ? "" : "warn"}`}>{quote.status === "closed_won" ? "Closed - Won" : quote.status === "closed_lost" ? "Closed - Lost" : "Open"}</span>
                        <span className={taskPillClass}>{taskPillLabel}</span>
                      </span>
                    </button>
                  );
                })}
                {salesQuotes.length === 0 && <div className="empty-compact-state">No sites yet. New Site to start scoping one.</div>}
              </div>
            </>
          )}
        </section>
      )}

      {mode === "detail" && selectedQuote && (
        <section className="panel wide">
          <div className="panel-title-row">
            <div>
              <button className="secondary-action mini-action" type="button" onClick={backToList}>&larr; Back to quotes</button>
              {selectedQuote.quoteRef && <div className="locked-ref-inline"><span>Ref</span><strong>{selectedQuote.quoteRef}</strong></div>}
              <h2>{selectedQuote.siteName}</h2>
              <p>
                {selectedQuote.clientName} - {selectedQuote.city || "No city set"} - Started by {selectedQuote.createdByEmail || "Unknown"}
                {" "}
                <button className="link-button" type="button" onClick={() => setIsEditingSiteInfo(true)}>Edit</button>
              </p>
              <label className="quote-status-field">
                Deal status
                <select
                  value={selectedQuote.status}
                  disabled={isCreatingProject}
                  onChange={(event) => handleStatusChange(selectedQuote, event.target.value as SalesQuote["status"])}
                >
                  <option value="open">Open</option>
                  <option value="closed_won">Closed - Won</option>
                  <option value="closed_lost">Closed - Lost</option>
                </select>
              </label>
              {selectedQuote.status === "closed_won" && (
                <div className="quote-header-pill-row">
                  <button
                    className="secondary-action mini-action mini-action-sm"
                    type="button"
                    disabled={isCreatingProject}
                    onClick={() => runCreateProjectFromQuote(selectedQuote)}
                  >
                    {isCreatingProject ? "Creating..." : "Create Project"}
                  </button>
                  {!projectCreateStatus && (
                    <small className="muted">Copies this quote into a Project -- safe to click again if it didn't work the first time.</small>
                  )}
                </div>
              )}
              {projectCreateStatus && <small className="muted">{projectCreateStatus}</small>}
            </div>
            <div className="quote-detail-actions">
              <div className="quote-header-pill-row">
                <button className="secondary-action mini-action mini-action-sm" type="button" onClick={() => onAddLocation(selectedQuote.id, "garage")}>+ Garage</button>
                <button className="secondary-action mini-action mini-action-sm" type="button" onClick={() => onAddLocation(selectedQuote.id, "lot")}>+ Lot</button>
                <button className="secondary-action mini-action mini-action-sm" type="button" onClick={() => setShowIntakeModal(true)}>
                  Intake{siteIntakeFieldCount > 0 ? ` (${siteIntakeAnsweredCount}/${siteIntakeFieldCount})` : ""}
                </button>
                <button
                  className="secondary-action mini-action mini-action-sm"
                  type="button"
                  onClick={() => {
                    // Print CSS only shows .quote-intake-print-area, which
                    // only exists in the DOM while the modal is open --
                    // open it first, then print once it's rendered.
                    setShowIntakeModal(true);
                    setTimeout(() => window.print(), 100);
                  }}
                >
                  Export PDF
                </button>
                <button className="secondary-action mini-action mini-action-sm" type="button" onClick={() => setShowSiteGallery(true)}>
                  Site Gallery
                </button>
              </div>
              <RequestTaskButton
                section="sales_quotes"
                contextNote={`Regarding quote: ${selectedQuote.siteName} (${selectedQuote.clientName})`}
                quoteId={selectedQuote.id}
                label="S.E Request"
                teamMembers={teamMembers}
                projectSites={projectSites}
                onCreate={onCreateTask}
              />
            </div>
          </div>

          <table className="stack-table-mobile">
            <thead>
              <tr><th>Type</th><th>Name</th><th>Photos</th><th>Files</th><th></th></tr>
            </thead>
            <tbody>
              {selectedQuote.locations.map((location) => {
                const photoCount = location.images.filter((image) => image.imageType === "photo").length;
                const drawingCount = location.images.filter((image) => image.imageType === "drawing").length;
                return (
                  <tr key={location.id} className="clickable-row" onClick={() => setSelectedLocationId(location.id)}>
                    <td><span className={`status ${location.locationType === "garage" ? "ok" : ""}`}>{location.locationType === "garage" ? "Garage" : "Lot"}</span></td>
                    <td>
                      <input
                        className="quote-location-row-name"
                        value={location.name}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => onUpdateLocation(selectedQuote.id, location.id, { name: event.target.value })}
                        placeholder={location.locationType === "garage" ? "Garage name" : "Lot name"}
                      />
                    </td>
                    <td>
                      <button
                        className="icon-count-button"
                        type="button"
                        title="Take Photos"
                        onClick={(event) => {
                          event.stopPropagation();
                          setCameraLocationId(location.id);
                        }}
                      >
                        <Camera size={16} /><span>{photoCount}</span>
                      </button>
                    </td>
                    <td>
                      <button
                        className="icon-count-button"
                        type="button"
                        title="View files"
                        onClick={(event) => {
                          event.stopPropagation();
                          setFilesLocationId(location.id);
                        }}
                      >
                        <FileText size={16} /><span>{drawingCount}</span>
                      </button>
                    </td>
                    <td className="row-delete-cell">
                      <button
                        className="icon-button compact-remove row-delete-btn"
                        type="button"
                        title={`Delete ${location.locationType === "garage" ? "garage" : "lot"}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (window.confirm(`Delete "${location.name || (location.locationType === "garage" ? "this garage" : "this lot")}"? Its photos, files, and hardware line items go with it. This can't be undone.`)) {
                            onDeleteLocation(selectedQuote.id, location.id);
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {selectedQuote.locations.length === 0 && (
                <tr><td colSpan={5} className="empty-compact-state">No garages or lots yet. Use + Garage / + Lot above.</td></tr>
              )}
            </tbody>
          </table>

          <div className="quote-hardware-summary">
            <span className="label">Quote Hardware Summary</span>
            <p className="muted">Running tally from the location details collected so far.</p>
            <ul className="quote-hardware-summary-list">
              {[
                { label: "Garages", value: selectedQuote.locations.filter((location) => location.locationType === "garage").length },
                { label: "Lots", value: selectedQuote.locations.filter((location) => location.locationType === "lot").length },
                { label: "FLI locations", value: selectedQuote.locations.filter((location) => location.fli).length },
                { label: "LPR locations", value: selectedQuote.locations.filter((location) => location.lpr).length },
                { label: "People counting", value: selectedQuote.locations.filter((location) => location.peopleCounting).length },
                { label: "Total entries", value: selectedQuote.locations.reduce((sum, location) => sum + location.entriesCount, 0) },
                { label: "Total exits", value: selectedQuote.locations.reduce((sum, location) => sum + location.exitsCount, 0) },
                { label: "Total levels", value: selectedQuote.locations.reduce((sum, location) => sum + location.levelsCount, 0) },
              ]
                .filter((stat) => stat.value > 0)
                .map((stat) => (
                  <li key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong></li>
                ))}
              {selectedQuote.locations.length === 0 && <li className="empty-compact-state">Nothing recorded yet.</li>}
            </ul>
            <span className="label">Recommended Hardware (v1, whole site)</span>
            <p className="muted">Rolled up from every location using the Site Hardware Rules -- tune those rules in Admin as real numbers come in.</p>
            <ul className="quote-hardware-summary-list">
              {computeQuoteHardware(selectedQuote.locations, siteHardwareRules).map((line) => (
                <li key={line.itemName}><span>{line.itemName}</span><strong>{line.qty}</strong></li>
              ))}
              {computeQuoteHardware(selectedQuote.locations, siteHardwareRules).length === 0 && (
                <li className="empty-compact-state">Nothing recommended yet.</li>
              )}
            </ul>
          </div>

          <div className="quote-hardware-summary">
            <span className="label">Quote BOM</span>
            <p className="muted">Persisted line items for this quote -- this is what a Project pulls in once the quote is marked Closed - Won, and what a Quote Proposal's pricing table is built from.</p>
            <div className="submittal-create-row">
              <button
                className="primary-action mini-action"
                type="button"
                disabled={selectedQuote.locations.length === 0}
                onClick={() => onPullLocationHardware(selectedQuote.id)}
              >
                Pull Location Hardware into Quote BOM
              </button>
              <small className="muted">Rolls up every location's camera picks + Sign/Space Sensor/Misc lines. Safe to click again after editing a location -- it only replaces the lines it previously pulled in.</small>
            </div>
            <ul className="line-list">
              {selectedQuote.bomLines.map((line) => {
                const linkedItem = line.catalogItemId ? catalogItems.find((item) => item.id === line.catalogItemId) : undefined;
                const sourceLocation = line.sourceLocationId ? selectedQuote.locations.find((location) => location.id === line.sourceLocationId) : undefined;
                return (
                  <li className="line-item" key={line.id}>
                    <div>
                      <strong>{line.item}</strong>
                      <span>Qty {line.qty}{line.notes ? ` -- ${line.notes}` : ""}</span>
                      {line.sourceLocationId && (
                        <small className="muted">
                          {sourceLocation ? `Pulled from ${sourceLocation.name || "a location"}` : "Pulled from a location (since removed)"}
                        </small>
                      )}
                      <select
                        className="bom-line-catalog-link"
                        value={line.catalogItemId ?? ""}
                        onChange={(event) => onUpdateBomLineCatalogLink(selectedQuote.id, line.id, event.target.value || null)}
                      >
                        <option value="">No catalog link (labor/service line)</option>
                        {activeCatalogItems.map((item) => (
                          <option key={item.id} value={item.id}>{item.productName}</option>
                        ))}
                      </select>
                      {linkedItem && <small className="muted">Pulls image, description &amp; datasheet from: {linkedItem.productName}</small>}
                    </div>
                    <button className="icon-button" type="button" onClick={() => onDeleteBomLine(selectedQuote.id, line.id)} aria-label="Remove line">x</button>
                  </li>
                );
              })}
              {selectedQuote.bomLines.length === 0 && <li className="empty-compact-state">No BOM lines yet.</li>}
            </ul>
            <div className="submittal-create-row">
              <input placeholder="Item name" value={bomLineDraft.item} onChange={(event) => setBomLineDraft({ ...bomLineDraft, item: event.target.value })} />
              <input type="number" min={0.01} step={0.01} value={bomLineDraft.qty} onChange={(event) => setBomLineDraft({ ...bomLineDraft, qty: Number(event.target.value) || 1 })} />
              <input placeholder="Notes (optional)" value={bomLineDraft.notes} onChange={(event) => setBomLineDraft({ ...bomLineDraft, notes: event.target.value })} />
              <select value={bomLineDraft.catalogItemId} onChange={(event) => setBomLineDraft({ ...bomLineDraft, catalogItemId: event.target.value })}>
                <option value="">No catalog link (optional)</option>
                {activeCatalogItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.productName}</option>
                ))}
              </select>
              <button
                className="secondary-action mini-action"
                type="button"
                disabled={!bomLineDraft.item.trim()}
                onClick={() => {
                  onAddBomLines(selectedQuote.id, [
                    { item: bomLineDraft.item.trim(), qty: bomLineDraft.qty, notes: bomLineDraft.notes.trim() || undefined, catalogItemId: bomLineDraft.catalogItemId || undefined },
                  ]);
                  setBomLineDraft({ item: "", qty: 1, notes: "", catalogItemId: "" });
                }}
              >
                + Add line
              </button>
            </div>

            <span className="label">Pre-Sales Quick Estimate</span>
            <p className="muted">Derive a baseline hardware list from Product Catalog category, node count, and connectivity -- adds straight into the Quote BOM above. Configure categories and quantities in Admin -&gt; Pre-Sales Rules.</p>
            {presalesStatus && <small className="muted">{presalesStatus}</small>}
            <div className="submittal-create-row">
              <select value={presalesTier} onChange={(event) => setPresalesTier(event.target.value)}>
                <option value="">Select category...</option>
                {catalogCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <input type="number" min={1} value={presalesNodeCount} onChange={(event) => setPresalesNodeCount(Number(event.target.value) || 1)} placeholder="Node count" />
              <label className="checkbox-inline-field">
                <input type="checkbox" checked={presalesCloudSync} onChange={(event) => setPresalesCloudSync(event.target.checked)} />
                Cloud sync required
              </label>
              <button
                className="primary-action mini-action"
                type="button"
                disabled={!presalesTier}
                onClick={() => onGenerateBaselineBom(selectedQuote.id, presalesTier, presalesNodeCount, presalesCloudSync)}
              >
                Generate Baseline BOM
              </button>
            </div>

            <span className="label">Quote Proposal</span>
            <p className="muted">
              Client-facing proposal built from this quote's BOM plus the shared boilerplate wording (edit that wording in Admin -&gt; Proposal Template).
              v1 is a shareable web page, not a generated PDF file -- use your browser's Print/Save as PDF for a PDF copy once a client approves.
            </p>
            <div className="submittal-create-row">
              <input
                placeholder="Client email"
                value={proposalClientEmailDraft}
                onChange={(event) => setProposalClientEmailDraft(event.target.value)}
                onBlur={() => {
                  if (proposalClientEmailDraft.trim() !== (selectedQuote.clientEmail ?? "")) {
                    onUpdateProposalFields(selectedQuote.id, { clientEmail: proposalClientEmailDraft.trim() });
                  }
                }}
              />
            </div>
            <label className="quote-status-field">
              Executive summary (hand-written per deal)
              <textarea
                value={proposalSummaryDraft}
                onChange={(event) => setProposalSummaryDraft(event.target.value)}
                onBlur={() => {
                  if (proposalSummaryDraft !== (selectedQuote.proposalSummary ?? "")) {
                    onUpdateProposalFields(selectedQuote.id, { proposalSummary: proposalSummaryDraft });
                  }
                }}
                rows={3}
                placeholder="A short paragraph introducing this proposal to the client..."
              />
            </label>
            <button
              className="primary-action mini-action"
              type="button"
              disabled={!proposalClientEmailDraft.trim()}
              onClick={() => onCreateQuoteProposal(selectedQuote)}
            >
              Create &amp; Send Proposal
            </button>
            {quoteProposalStatus && <small className="muted">{quoteProposalStatus}</small>}
            <div className="submittal-list">
              {quoteProposals.filter((proposal) => proposal.quoteId === selectedQuote.id).length === 0 && (
                <div className="empty-compact-state">No proposals yet for this quote.</div>
              )}
              {quoteProposals
                .filter((proposal) => proposal.quoteId === selectedQuote.id)
                .map((proposal) => (
                  <div className="submittal-row" key={proposal.id}>
                    <div className="submittal-row-head">
                      <strong>Version {proposal.version}</strong>
                      <span className={`status-pill submittal-status-${proposal.status}`}>{proposal.status.replace(/_/g, " ")}</span>
                    </div>
                    <div className="submittal-meta">
                      <span>Sent {proposal.sentAt ? new Date(proposal.sentAt).toLocaleDateString() : "-"}</span>
                      {proposal.respondedAt && (
                        <span>Responded {new Date(proposal.respondedAt).toLocaleDateString()} by {proposal.approvalName || "client"}</span>
                      )}
                    </div>
                    {proposal.responseNotes && <p className="submittal-notes">"{proposal.responseNotes}"</p>}
                    {proposal.shareToken && (
                      <button
                        className={`secondary-action mini-action ${copiedProposalId === proposal.id ? "just-copied" : ""}`}
                        type="button"
                        onClick={() => {
                          const link = `${window.location.origin}${window.location.pathname}?proposal=${proposal.shareToken}`;
                          navigator.clipboard?.writeText(link).then(() => {
                            setCopiedProposalId(proposal.id);
                            setTimeout(() => setCopiedProposalId(""), 2000);
                          });
                        }}
                      >
                        {copiedProposalId === proposal.id ? "Copied!" : "Copy client link"}
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </section>
      )}

      {selectedLocation && selectedQuote && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="quote-location-title">
            <div className="modal-header">
              <div>
                <h2 id="quote-location-title">{selectedLocation.name || (selectedLocation.locationType === "garage" ? "Garage" : "Lot")}</h2>
                <p>Site details the hardware rules engine will use.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setSelectedLocationId(null)} aria-label="Close location details">x</button>
            </div>
            <div className="bom-modal-grid">
              <label className="span-2">Address<input value={selectedLocation.address} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { address: event.target.value })} placeholder="This garage/lot's own address, if different from the client address" /></label>
              <p className="span-2 muted">General info for reference only -- doesn't drive anything below. Actual camera hardware is picked in the Cameras section.</p>
              <label className="checkbox-inline">
                <input type="checkbox" checked={selectedLocation.fli} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { fli: event.target.checked })} /> FLI
              </label>
              <label className="checkbox-inline">
                <input type="checkbox" checked={selectedLocation.lpr} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { lpr: event.target.checked })} /> LPR
              </label>
              <label className="checkbox-inline">
                <input type="checkbox" checked={selectedLocation.peopleCounting} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { peopleCounting: event.target.checked })} /> People counting
              </label>
              <label>Entries<input className="qty-input-narrow" type="number" min={0} max={999} value={selectedLocation.entriesCount} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { entriesCount: Number(event.target.value) || 0 })} /></label>
              <label>Exits<input className="qty-input-narrow" type="number" min={0} max={999} value={selectedLocation.exitsCount} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { exitsCount: Number(event.target.value) || 0 })} /></label>
              <label>Levels<input className="qty-input-narrow" type="number" min={0} max={999} value={selectedLocation.levelsCount} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { levelsCount: Number(event.target.value) || 0 })} /></label>
            </div>
            <div className="note-list">
              <p><strong>Recommended Hardware</strong> -- v1 estimate from the Site Hardware Rules in Admin, based on the checkboxes and counts above. Tune the rules there as real numbers come in.</p>
              {(() => {
                const recommended = computeLocationHardware(selectedLocation, siteHardwareRules);
                return recommended.length > 0 ? (
                  <ul className="quote-hardware-summary-list">
                    {recommended.map((line) => (
                      <li key={line.itemName}><span>{line.itemName}</span><strong>{line.qty}</strong></li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Nothing recommended yet -- check FLI/LPR/People Counting or add entry/exit/level counts above.</p>
                );
              })()}
            </div>

            <LocationItemLineSection
              title="Cameras"
              hint="Cameras for this facility, pulled straight from the Product Catalog."
              items={selectedLocation.cameraLines}
              catalogItems={catalogItems}
              options={cameraCatalogItems}
              accessoryOptions={cameraAccessoryCatalogItems}
              draft={cameraItemDraft}
              onDraftChange={setCameraItemDraft}
              onAdd={() => {
                onAddLocationItem(selectedQuote.id, selectedLocation.id, "camera", cameraItemDraft.catalogItemId, cameraItemDraft.qty, {
                  locationLabel: cameraItemDraft.locationLabel,
                  accessoryCatalogItemId: cameraItemDraft.accessoryCatalogItemId || null,
                  accessoryQty: cameraItemDraft.accessoryQty,
                });
                setCameraItemDraft(emptyLineDraft);
              }}
              onUpdateItem={(itemId, updates) => onUpdateLocationItem(selectedQuote.id, selectedLocation.id, itemId, updates)}
              onDelete={(itemId) => onDeleteLocationItem(selectedQuote.id, selectedLocation.id, itemId)}
            />

            <LocationItemLineSection
              title="Signs"
              hint="Signage for this facility, pulled straight from the Product Catalog."
              items={selectedLocation.signLines}
              catalogItems={catalogItems}
              options={signCatalogItems}
              accessoryOptions={signAccessoryCatalogItems}
              draft={signItemDraft}
              onDraftChange={setSignItemDraft}
              onAdd={() => {
                onAddLocationItem(selectedQuote.id, selectedLocation.id, "sign", signItemDraft.catalogItemId, signItemDraft.qty, {
                  locationLabel: signItemDraft.locationLabel,
                  accessoryCatalogItemId: signItemDraft.accessoryCatalogItemId || null,
                  accessoryQty: signItemDraft.accessoryQty,
                });
                setSignItemDraft(emptyLineDraft);
              }}
              onUpdateItem={(itemId, updates) => onUpdateLocationItem(selectedQuote.id, selectedLocation.id, itemId, updates)}
              onDelete={(itemId) => onDeleteLocationItem(selectedQuote.id, selectedLocation.id, itemId)}
            />

            <LocationItemLineSection
              title="Space Sensor"
              hint="Sensors for this facility -- catalog items tagged sensor or filed under the Space Sensors category."
              items={selectedLocation.sensorLines}
              catalogItems={catalogItems}
              options={sensorCatalogItems}
              accessoryOptions={sensorAccessoryCatalogItems}
              draft={sensorItemDraft}
              onDraftChange={setSensorItemDraft}
              onAdd={() => {
                onAddLocationItem(selectedQuote.id, selectedLocation.id, "sensor", sensorItemDraft.catalogItemId, sensorItemDraft.qty, {
                  locationLabel: sensorItemDraft.locationLabel,
                  accessoryCatalogItemId: sensorItemDraft.accessoryCatalogItemId || null,
                  accessoryQty: sensorItemDraft.accessoryQty,
                });
                setSensorItemDraft(emptyLineDraft);
              }}
              onUpdateItem={(itemId, updates) => onUpdateLocationItem(selectedQuote.id, selectedLocation.id, itemId, updates)}
              onDelete={(itemId) => onDeleteLocationItem(selectedQuote.id, selectedLocation.id, itemId)}
            />

            <LocationItemLineSection
              title="Misc."
              hint="Anything else for this facility -- the whole Product Catalog is available here."
              items={selectedLocation.miscLines}
              catalogItems={catalogItems}
              options={activeCatalogItems}
              accessoryOptions={activeCatalogItems}
              draft={miscItemDraft}
              onDraftChange={setMiscItemDraft}
              onAdd={() => {
                onAddLocationItem(selectedQuote.id, selectedLocation.id, "misc", miscItemDraft.catalogItemId, miscItemDraft.qty, {
                  locationLabel: miscItemDraft.locationLabel,
                  accessoryCatalogItemId: miscItemDraft.accessoryCatalogItemId || null,
                  accessoryQty: miscItemDraft.accessoryQty,
                });
                setMiscItemDraft(emptyLineDraft);
              }}
              onUpdateItem={(itemId, updates) => onUpdateLocationItem(selectedQuote.id, selectedLocation.id, itemId, updates)}
              onDelete={(itemId) => onDeleteLocationItem(selectedQuote.id, selectedLocation.id, itemId)}
            />

            {selectedLocation.images.length > 0 && (
              <div className="line-list">
                {selectedLocation.images.map((image) => (
                  <div className="line-item quote-image-line-item" key={image.id}>
                    <div>
                      <strong>{image.fileName || (image.imageType === "photo" ? "Photo" : "Drawing")}</strong>
                      <span>{image.imageType === "photo" ? "Photo" : "Drawing"}</span>
                      {image.imageType === "photo" && (
                        <input
                          className="quote-image-description-input"
                          value={image.description}
                          placeholder="Description (optional)"
                          onChange={(event) => onUpdateImageDescription(selectedQuote.id, selectedLocation.id, image.id, event.target.value)}
                        />
                      )}
                      <small className="muted">{formatImageProvenance(image)}</small>
                    </div>
                    <button className="secondary-action mini-action" type="button" onClick={() => onDownloadImage(image)}>Download</button>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setSelectedLocationId(null)}>Close</button>
            </div>
          </section>
        </div>
      )}

      {cameraLocationId && selectedQuote && (
        <CameraCaptureModal
          quoteId={selectedQuote.id}
          locationId={cameraLocationId}
          locationName={selectedQuote.locations.find((location) => location.id === cameraLocationId)?.name || "this location"}
          onClose={() => setCameraLocationId(null)}
          onSavePhoto={(file, description, coords) => onUploadImage(selectedQuote.id, cameraLocationId, "photo", file, description, coords)}
        />
      )}

      {filesLocationId && selectedQuote && (
        <LocationFilesModal
          locationName={selectedQuote.locations.find((location) => location.id === filesLocationId)?.name || "this location"}
          locationId={filesLocationId}
          locations={selectedQuote.locations}
          files={selectedQuote.locations.find((location) => location.id === filesLocationId)?.images.filter((image) => image.imageType === "drawing") ?? []}
          onUpload={(file) => onUploadImage(selectedQuote.id, filesLocationId, "drawing", file)}
          onDownload={onDownloadImage}
          onDelete={(image) => onDeleteImage(selectedQuote.id, filesLocationId, image.id, image.storagePath)}
          onGetUrl={onGetImageUrl}
          onUpdate={(image, updates) => onUpdateImageMeta(selectedQuote.id, filesLocationId, image.id, updates)}
          onMove={(image, targetLocationId) => onMoveImage(selectedQuote.id, filesLocationId, image.id, targetLocationId)}
          onClose={() => setFilesLocationId(null)}
        />
      )}

      {showSiteGallery && selectedQuote && (
        <SiteGalleryModal
          siteName={selectedQuote.siteName}
          locations={selectedQuote.locations}
          onGetUrl={onGetImageUrl}
          onUpdate={(locationId, image, updates) => onUpdateImageMeta(selectedQuote.id, locationId, image.id, updates)}
          onMove={(locationId, image, targetLocationId) => onMoveImage(selectedQuote.id, locationId, image.id, targetLocationId)}
          onDelete={(locationId, image) => onDeleteImage(selectedQuote.id, locationId, image.id, image.storagePath)}
          onClose={() => setShowSiteGallery(false)}
        />
      )}

      {showNewQuoteModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-quote-title">
            <div className="modal-header">
              <div>
                <h2 id="new-quote-title">New Site</h2>
                <p>Garage/lot counts create line items below to name individually after creating.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowNewQuoteModal(false)} aria-label="Close new quote form">x</button>
            </div>
            <SiteContactFields
              values={newQuoteDraft}
              onChange={(patch) => setNewQuoteDraft((current) => ({ ...current, ...patch }))}
              garageCount={newQuoteDraft.garageCount}
              lotCount={newQuoteDraft.lotCount}
              onGarageCountChange={(value) => setNewQuoteDraft((current) => ({ ...current, garageCount: value }))}
              onLotCountChange={(value) => setNewQuoteDraft((current) => ({ ...current, lotCount: value }))}
            />
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowNewQuoteModal(false)}>Cancel</button>
              <button className="primary-action" type="button" onClick={submitNewQuote} disabled={!newQuoteDraft.clientName.trim() || !newQuoteDraft.siteName.trim()}>Create Quote</button>
            </div>
          </section>
        </div>
      )}

      {/* #164 follow-up -- E asked for the original "New Site" sheet itself to
          reopen as a pop-up (not an inline edit row), since more fields are
          still coming to it. Garages/Parking lots are shown read-only here --
          those counts only ever drove one-time location creation; adding more
          after the fact is what the "+ Garage"/"+ Lot" buttons in the header
          are for, so letting this modal's counters silently create/destroy
          named locations would be surprising. */}
      {isEditingSiteInfo && selectedQuote && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="edit-site-title">
            <div className="modal-header">
              <div>
                <h2 id="edit-site-title">Edit Site</h2>
                <p>Update the original intake info for this site.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setIsEditingSiteInfo(false)} aria-label="Close edit site form">x</button>
            </div>
            <SiteContactFields
              values={siteInfoDraft}
              onChange={(patch) => setSiteInfoDraft((current) => ({ ...current, ...patch }))}
              garageCount={selectedQuote.locations.filter((location) => location.locationType === "garage").length}
              lotCount={selectedQuote.locations.filter((location) => location.locationType === "lot").length}
            />
            <div className="modal-section">
              <span className="modal-section-title">SaaS Contract</span>
              <p className="muted">Feeds the SaaS Calendar's renewal tracking and revenue numbers once this deal closes and carries over to the Project.</p>
              <div className="tight-form-rows">
                <div className="tight-form-row">
                  <label className="tight-field tight-field-wide"><span>SaaS type</span><input value={saasDraft.saasType} onChange={(event) => setSaasDraft((current) => ({ ...current, saasType: event.target.value }))} placeholder="e.g. Cloud Monitoring, Analytics" /></label>
                  <label className="tight-field tight-field-medium">
                    <span>Contract amount</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={saasDraft.saasContractAmount ?? ""}
                      onChange={(event) => setSaasDraft((current) => ({ ...current, saasContractAmount: event.target.value === "" ? null : Number(event.target.value) }))}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="tight-field tight-field-medium">
                    <span>Billing frequency</span>
                    <select value={saasDraft.saasBillingFrequency} onChange={(event) => setSaasDraft((current) => ({ ...current, saasBillingFrequency: event.target.value as SalesQuote["saasBillingFrequency"] }))}>
                      <option value="">Select...</option>
                      <option value="Monthly">Monthly</option>
                      <option value="Quarterly">Quarterly</option>
                      <option value="Annual">Annual</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setIsEditingSiteInfo(false)}>Cancel</button>
              <button className="primary-action" type="button" onClick={saveSiteInfo} disabled={!siteInfoDraft.clientName.trim() || !siteInfoDraft.siteName.trim()}>Save</button>
            </div>
          </section>
        </div>
      )}

      {/* #168 -- was a fully-expanded inline panel, causing a lot of
          scrolling on a long site. Now opened on demand from the compact
          trigger button above the locations table. */}
      {showIntakeModal && selectedQuote && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="site-intake-title">
            <div className="modal-header">
              <div className="quote-intake-print-area">
                <h2 id="site-intake-title">Site Intake Questionnaire</h2>
                <p>Questions to ask the client while scoping this site. Grows over time -- add/edit/reorder questions in Admin -&gt; Form Builder.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowIntakeModal(false)} aria-label="Close site intake questionnaire">x</button>
            </div>
            {quoteIntakeStatus && <small className="muted">{quoteIntakeStatus}</small>}
            <div className="quote-intake-print-area">
            <SiteContactFields
              values={selectedQuote}
              onChange={(patch) => onUpdateQuoteInfo(selectedQuote.id, patch)}
              garageCount={selectedQuote.locations.filter((location) => location.locationType === "garage").length}
              lotCount={selectedQuote.locations.filter((location) => location.locationType === "lot").length}
            />
            <div className="modal-section">
              <span className="modal-section-title">Site-Specific Questions</span>
              {siteIntakeSchema && siteIntakeSchema.fields.length > 0 ? (
              <div className="form-grid">
                {[...siteIntakeSchema.fields].sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((field) => {
                  const responses = siteIntakeResponses;
                  const saveField = (value: string) => onSaveQuoteIntakeResponses(selectedQuote.id, { ...responses, [field.fieldKey]: value });
                  return (
                    <label key={field.id} className={field.fieldType === "textarea" ? "span-2" : undefined}>
                      <span>{field.label}{field.isRequired ? " *" : ""}</span>
                      {field.fieldType === "select" ? (
                        <select value={responses[field.fieldKey] ?? ""} onChange={(event) => saveField(event.target.value)}>
                          <option value="">Select...</option>
                          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      ) : field.fieldType === "textarea" ? (
                        <textarea value={responses[field.fieldKey] ?? ""} placeholder={field.placeholder} onChange={(event) => saveField(event.target.value)} />
                      ) : field.fieldType === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={responses[field.fieldKey] === "true"}
                          onChange={(event) => saveField(event.target.checked ? "true" : "false")}
                        />
                      ) : (
                        <input
                          type={field.fieldType === "date" ? "date" : field.fieldType === "number" ? "number" : "text"}
                          value={responses[field.fieldKey] ?? ""}
                          placeholder={field.placeholder}
                          onChange={(event) => saveField(event.target.value)}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
              ) : (
                <span className="empty-compact-state">No intake questions configured yet -- add some in Admin -&gt; Form Builder.</span>
              )}
            </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => window.print()}>Print / Save as PDF</button>
              <button className="primary-action" type="button" onClick={() => setShowIntakeModal(false)}>Done</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

const EMPTY_TASK_DRAFT = {
  title: "",
  description: "",
  section: "general" as TaskSection,
  projectRef: "",
  quoteId: "",
  isInternal: true,
  status: "to_do" as TaskStatus,
  priority: "normal" as TaskPriority,
  category: "",
  impactAreas: [] as string[],
  assigneeUserId: null as string | null,
  assigneeEmail: "",
  assignedRoleKey: null as string | null,
  startDate: "",
  dueDate: "",
};

function priorityBadgeClass(priority: TaskPriority) {
  return `priority-pill priority-${priority}`;
}

// Small inline "Request" trigger for the Product Catalog toolbar and each
// Quote Builder detail page -- opens the same task form as everywhere else,
// pre-scoped to the calling area's section, without duplicating a whole
// TaskMiniPanel (list + Open in Tasks + its own Add) in every sub-view. The
// single combined "Sales Tasks" review panel at the top of the Sales page is
// where those tasks actually get reviewed/worked; this is just how they get
// created from wherever the need comes up.
function RequestTaskButton({
  section,
  contextNote,
  quoteId,
  label,
  teamMembers,
  projectSites,
  onCreate,
}: {
  section: TaskSection;
  contextNote?: string;
  quoteId?: string;
  label?: string;
  teamMembers: TeamMember[];
  projectSites: ProjectSite[];
  onCreate: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);

  function openModal() {
    setDraft({ ...EMPTY_TASK_DRAFT, section, isInternal: true, description: contextNote ?? "", quoteId: quoteId ?? "" });
    setOpen(true);
  }

  async function submit() {
    if (!draft.title.trim()) {
      return false;
    }
    return onCreate(draft);
  }

  return (
    <>
      <button className="secondary-action mini-action" type="button" onClick={openModal}>
        <Plus size={14} /> {label ?? "Request"}
      </button>
      {open && (
        <TaskEditorModal
          draft={draft}
          setDraft={setDraft}
          editingId={null}
          projectSites={projectSites}
          teamMembers={teamMembers}
          onSubmit={submit}
          onClose={() => setOpen(false)}
          lockSection
        />
      )}
    </>
  );
}

type TaskGroupBy = "status" | "assignee" | "section";
type TaskDraft = typeof EMPTY_TASK_DRAFT;

function assigneeLabel(email: string, teamMembers: TeamMember[]) {
  if (!email) {
    return "Unassigned";
  }
  return teamMembers.find((member) => member.email && member.email.toLowerCase() === email.toLowerCase())?.fullName ?? email;
}

function roleLabelFor(roleKey: string) {
  return ROLE_KEY_OPTIONS.find((option) => option.value === roleKey)?.label ?? roleKey;
}

// A task is assigned to either one person or a whole role/team, never both
// (see EOTask.assignedRoleKey) -- this is the single place that decides
// which to show, so every list/board/card stays consistent.
function taskAssigneeLabel(task: EOTask, teamMembers: TeamMember[]) {
  if (task.assignedRoleKey) {
    return `${roleLabelFor(task.assignedRoleKey)} team`;
  }
  return assigneeLabel(task.assigneeEmail, teamMembers);
}

function formatTaskFieldValue(value: string) {
  return value ? value : "(none)";
}

// Builds a human-readable summary of what changed between two saves of the
// same task, for the activity log (see handleUpdateTask). Close/Reopen are
// called out explicitly rather than shown as a raw status diff, since those
// are the two actions E specifically asked to have tracked by who and when.
function describeTaskChanges(previous: EOTask, updated: EOTask): string {
  const changes: string[] = [];

  if (previous.deletedAt !== updated.deletedAt) {
    if (!previous.deletedAt && updated.deletedAt) {
      changes.push("Deleted the task.");
    } else if (previous.deletedAt && !updated.deletedAt) {
      changes.push("Restored the task.");
    }
  }
  if (previous.status !== updated.status) {
    const wasClosed = previous.status === "done";
    const isClosed = updated.status === "done";
    if (!wasClosed && isClosed && updated.closedAt) {
      changes.push("Closed the task.");
    } else if (wasClosed && !isClosed && !updated.closedAt) {
      changes.push("Reopened the task.");
    } else {
      changes.push(`Status: ${previous.status} -> ${updated.status}`);
    }
  }
  if (previous.title !== updated.title) {
    changes.push(`Title: "${previous.title}" -> "${updated.title}"`);
  }
  if (previous.priority !== updated.priority) {
    changes.push(`Priority: ${previous.priority} -> ${updated.priority}`);
  }
  if (previous.assigneeEmail !== updated.assigneeEmail) {
    changes.push(`Assignee: ${formatTaskFieldValue(previous.assigneeEmail)} -> ${formatTaskFieldValue(updated.assigneeEmail)}`);
  }
  if (previous.assignedRoleKey !== updated.assignedRoleKey) {
    changes.push(`Assigned team: ${formatTaskFieldValue(previous.assignedRoleKey ?? "")} -> ${formatTaskFieldValue(updated.assignedRoleKey ?? "")}`);
  }
  if (previous.dueDate !== updated.dueDate) {
    changes.push(`Due date: ${formatTaskFieldValue(previous.dueDate)} -> ${formatTaskFieldValue(updated.dueDate)}`);
  }
  if (previous.startDate !== updated.startDate) {
    changes.push(`Start date: ${formatTaskFieldValue(previous.startDate)} -> ${formatTaskFieldValue(updated.startDate)}`);
  }
  if (previous.section !== updated.section) {
    changes.push(`Section: ${previous.section} -> ${updated.section}`);
  }
  if (previous.category !== updated.category) {
    changes.push(`Category: ${formatTaskFieldValue(previous.category)} -> ${formatTaskFieldValue(updated.category)}`);
  }
  if (previous.description !== updated.description) {
    changes.push("Updated the description.");
  }
  if (JSON.stringify(previous.impactAreas) !== JSON.stringify(updated.impactAreas)) {
    changes.push(`Affects: ${updated.impactAreas.join(", ") || "(none)"}`);
  }
  if (previous.isInternal !== updated.isInternal) {
    changes.push(`Internal: ${previous.isInternal ? "yes" : "no"} -> ${updated.isInternal ? "yes" : "no"}`);
  }

  return changes.length > 0 ? changes.join("; ") : "Updated the task.";
}

function taskGroupDefs(groupBy: TaskGroupBy, teamMembers: TeamMember[], tasks: EOTask[]): Array<{ key: string; label: string; pillClass?: string }> {
  if (groupBy === "status") {
    return TASK_STATUS_OPTIONS.map((option) => ({ key: option.value, label: option.label, pillClass: `status-pill status-${option.value}` }));
  }
  if (groupBy === "section") {
    return TASK_SECTION_OPTIONS.map((option) => ({ key: option.value, label: option.label }));
  }
  const seen = new Set<string>();
  const groups: Array<{ key: string; label: string }> = [];
  tasks.forEach((task) => {
    if (task.assignedRoleKey) {
      const roleGroupKey = `role:${task.assignedRoleKey}`;
      if (!seen.has(roleGroupKey)) {
        seen.add(roleGroupKey);
        groups.push({ key: roleGroupKey, label: `${roleLabelFor(task.assignedRoleKey)} (team)` });
      }
      return;
    }
    const key = task.assigneeEmail || "";
    if (key && !seen.has(key)) {
      seen.add(key);
      groups.push({ key, label: assigneeLabel(key, teamMembers) });
    }
  });
  groups.sort((a, b) => a.label.localeCompare(b.label));
  groups.push({ key: "", label: "Unassigned" });
  return groups;
}

function taskMatchesGroup(task: EOTask, groupBy: TaskGroupBy, key: string) {
  if (groupBy === "status") {
    return task.status === key;
  }
  if (groupBy === "section") {
    return task.section === key;
  }
  if (key.startsWith("role:")) {
    return task.assignedRoleKey === key.slice("role:".length);
  }
  return !task.assignedRoleKey && (task.assigneeEmail || "") === key;
}

function AssigneeSelect({ value, teamMembers, onChange }: { value: string; teamMembers: TeamMember[]; onChange: (email: string) => void }) {
  const activeMembers = teamMembers.filter((member) => member.isActive && member.email);
  const valueIsKnown = !value || activeMembers.some((member) => member.email.toLowerCase() === value.toLowerCase());
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Unassigned</option>
      {activeMembers.map((member) => (
        <option key={member.id} value={member.email}>{member.fullName}{member.roleTitle ? ` - ${member.roleTitle}` : ""}</option>
      ))}
      {!valueIsKnown && <option value={value}>{value} (not on roster)</option>}
    </select>
  );
}

function TaskEditorModal({
  draft,
  setDraft,
  editingId,
  editingTask,
  activityLog,
  onQuickStatusChange,
  projectSites,
  teamMembers,
  onSubmit,
  onClose,
  lockSection,
  lockProjectRef,
  taskDependencies,
  inventoryItems,
  onAddDependency,
  onDeleteDependency,
}: {
  draft: TaskDraft;
  setDraft: Dispatch<SetStateAction<TaskDraft>>;
  editingId: string | null;
  editingTask?: EOTask | null;
  activityLog?: TaskActivityEntry[];
  onQuickStatusChange?: (status: TaskStatus) => Promise<boolean>;
  projectSites: ProjectSite[];
  teamMembers: TeamMember[];
  onSubmit: () => Promise<boolean>;
  onClose: () => void;
  lockSection?: boolean;
  lockProjectRef?: boolean;
  taskDependencies?: TaskHardwareDependency[];
  inventoryItems?: Part[];
  onAddDependency?: (sku: string, qty: number) => void;
  onDeleteDependency?: (id: string) => void;
}) {
  const [depSku, setDepSku] = useState("");
  const [depQty, setDepQty] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const isClosed = editingTask?.status === "done" && Boolean(editingTask?.closedAt);

  async function handleSubmitClick() {
    if (!draft.title.trim() || isSubmitting) {
      return;
    }
    setSubmitError("");
    setIsSubmitting(true);
    const ok = await onSubmit();
    setIsSubmitting(false);
    if (ok) {
      onClose();
    } else {
      setSubmitError("Could not save this task. Check your connection and try again.");
    }
  }

  async function handleQuickStatus(status: TaskStatus) {
    if (!onQuickStatusChange || isSubmitting) {
      return;
    }
    setSubmitError("");
    setIsSubmitting(true);
    const ok = await onQuickStatusChange(status);
    setIsSubmitting(false);
    if (!ok) {
      setSubmitError(status === "done" ? "Could not close the task. Try again." : "Could not reopen the task. Try again.");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
        <div className="modal-header">
          <div>
            <h2 id="task-editor-title">{editingId ? "Edit Task" : "Add Task"}</h2>
            <p>Track work across sections and, when relevant, a specific project.</p>
            {editingTask && (
              <div className="task-audit-meta">
                <span>Created by {editingTask.createdByEmail || "Unknown"} on {new Date(editingTask.createdAt).toLocaleString()}</span>
              </div>
            )}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close task editor">x</button>
        </div>
        <div className="bom-modal-grid">
          <label className="span-2">Title<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Task title" /></label>
          {lockSection ? (
            <label>Section<input value={TASK_SECTION_OPTIONS.find((option) => option.value === draft.section)?.label ?? draft.section} disabled /></label>
          ) : (
            <label>Section<select value={draft.section} onChange={(event) => setDraft((current) => ({ ...current, section: event.target.value as TaskSection }))}>
              {TASK_SECTION_OPTIONS
                .filter((option) => option.value !== "sales_quotes" || draft.section === "sales_quotes")
                .map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select></label>
          )}
          {draft.section === "sales_quotes" && (
            <span className="muted span-2">Site Builder tasks are created from inside a specific site (its "S.E Request" button) so they stay linked to that site -- this one already is.</span>
          )}
          <label>Priority<select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as TaskPriority }))}>
            {TASK_PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select></label>
          <label>Status<select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as TaskStatus }))}>
            {TASK_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select></label>
          <label>Category<input value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="e.g. API, Portal, FLI" /></label>
          {!lockProjectRef && (
            <label className="checkbox-inline-field">
              <input
                type="checkbox"
                checked={draft.isInternal}
                onChange={(event) => setDraft((current) => ({ ...current, isInternal: event.target.checked, projectRef: event.target.checked ? "" : current.projectRef }))}
              />
              Internal (not tied to a client project)
            </label>
          )}
          {!lockProjectRef && !draft.isInternal && (
            <label>Project<select value={draft.projectRef} onChange={(event) => setDraft((current) => ({ ...current, projectRef: event.target.value }))}>
              <option value="">Select a project</option>
              {projectSites.map((project) => (
                <option key={project.ref} value={project.ref}>{project.ref} - {project.name}</option>
              ))}
            </select></label>
          )}
          <label>
            Assignee
            <AssigneeSelect
              value={draft.assigneeEmail}
              teamMembers={teamMembers}
              onChange={(email) => setDraft((current) => ({ ...current, assigneeEmail: email, assigneeUserId: null, assignedRoleKey: email ? null : current.assignedRoleKey }))}
            />
          </label>
          <label>
            Or assign to a whole team
            <select
              value={draft.assignedRoleKey ?? ""}
              onChange={(event) => {
                const roleKey = event.target.value || null;
                setDraft((current) => ({
                  ...current,
                  assignedRoleKey: roleKey,
                  assigneeEmail: roleKey ? "" : current.assigneeEmail,
                  assigneeUserId: roleKey ? null : current.assigneeUserId,
                }));
              }}
            >
              <option value="">-- individual assignee above --</option>
              {ROLE_KEY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {draft.assignedRoleKey && (
            <span className="muted span-2">Everyone with the {roleLabelFor(draft.assignedRoleKey)} role will be notified -- not just one person.</span>
          )}
          <label>Start date<input type="date" value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))} /></label>
          <label>Due date<input type="date" value={draft.dueDate} onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label>
          <label className="span-2">Description<textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Details, links, context" /></label>
          <div className="span-2">
            <span className="muted">Affects (optional): which parts of the business this task touches when complete</span>
            <div className="tag-picker-grid">
              {IMPACT_AREA_OPTIONS.map((tag) => {
                const checked = draft.impactAreas.includes(tag);
                return (
                  <label key={tag} className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setDraft((current) => ({
                          ...current,
                          impactAreas: event.target.checked
                            ? [...current.impactAreas, tag]
                            : current.impactAreas.filter((existing) => existing !== tag),
                        }));
                      }}
                    />
                    {tag}
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {editingId && onAddDependency && (
          <div className="linked-hardware-block">
            <span className="muted">Linked hardware -- reserved or queued for purchase automatically when this task moves to In Progress</span>
            <div className="submittal-list">
              {(taskDependencies ?? []).map((dep) => (
                <div className="submittal-row" key={dep.id}>
                  <div className="submittal-row-head">
                    <strong>Qty {dep.quantityRequired}</strong>
                    <span className={`status-pill submittal-status-${dep.fulfillmentStatus === "allocated" ? "approved" : dep.fulfillmentStatus === "procurement_queued" ? "sent" : "draft"}`}>
                      {dep.fulfillmentStatus.replace(/_/g, " ")}
                    </span>
                  </div>
                  {onDeleteDependency && (
                    <button className="secondary-action mini-action" type="button" onClick={() => onDeleteDependency(dep.id)}>Remove</button>
                  )}
                </div>
              ))}
              {(taskDependencies ?? []).length === 0 && <div className="empty-compact-state">No hardware linked yet.</div>}
            </div>
            <div className="submittal-create-row">
              <select value={depSku} onChange={(event) => setDepSku(event.target.value)}>
                <option value="">Select inventory item...</option>
                {(inventoryItems ?? []).map((item) => (
                  <option key={item.ref} value={item.ref}>{item.name} ({item.ref})</option>
                ))}
              </select>
              <input type="number" min={1} value={depQty} onChange={(event) => setDepQty(Number(event.target.value))} placeholder="Qty" />
              <button
                className="secondary-action mini-action"
                type="button"
                disabled={!depSku}
                onClick={() => { onAddDependency(depSku, depQty); setDepSku(""); setDepQty(1); }}
              >
                Link Hardware
              </button>
            </div>
          </div>
        )}

        <div className="task-modal-footer">
          {editingId && (
            <div className="task-activity-log">
              <span className="task-activity-log-label">Activity Log</span>
              <div className="task-activity-log-scroll">
                {(activityLog ?? []).length === 0 && <div className="empty-compact-state">No activity yet.</div>}
                {(activityLog ?? []).map((entry) => (
                  <div className="task-activity-entry" key={entry.id}>
                    <span><strong>{entry.actorEmail || "Unknown"}</strong> {entry.message}</span>
                    <small>{new Date(entry.createdAt).toLocaleString()}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
          {submitError && <div className="modal-error-text">{submitError}</div>}
          <div className="modal-actions">
            {editingId && onQuickStatusChange && (
              <div className="task-modal-footer-left">
                {isClosed ? (
                  <button className="secondary-action mini-action" type="button" disabled={isSubmitting} onClick={() => handleQuickStatus("to_do")}>Reopen Task</button>
                ) : (
                  <button className="secondary-action mini-action" type="button" disabled={isSubmitting} onClick={() => handleQuickStatus("done")}>Close Task</button>
                )}
                {isClosed && editingTask && (
                  <span className="muted">Closed by {editingTask.closedByEmail || "Unknown"} on {new Date(editingTask.closedAt).toLocaleString()}</span>
                )}
              </div>
            )}
            <button className="secondary-action" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-action" type="button" onClick={handleSubmitClick} disabled={!draft.title.trim() || isSubmitting}>
              {isSubmitting ? "Saving..." : editingId ? "Save Task" : "Add Task"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function TaskCard({ task, teamMembers, onUpdate, onEdit, onDelete, showStatusMove }: { task: EOTask; teamMembers: TeamMember[]; onUpdate: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => Promise<boolean>; onEdit: () => void; onDelete: () => void; showStatusMove?: boolean }) {
  return (
    <div className="task-card">
      <div className="task-card-top">
        <span className={priorityBadgeClass(task.priority)}>{task.priority}</span>
        {task.dueDate && <span className="task-card-due">{task.dueDate}</span>}
      </div>
      <strong className="task-card-title">{task.title}</strong>
      <div className="task-card-meta">
        <span>{taskAssigneeLabel(task, teamMembers)}</span>
        <span>{task.isInternal ? "Internal" : task.projectRef || "External"}</span>
      </div>
      {task.impactAreas.length > 0 && (
        <div className="tag-chip-row">{task.impactAreas.map((tag) => <span key={tag}>{tag}</span>)}</div>
      )}
      <div className="task-card-actions">
        {showStatusMove && (
          <select value={task.status} onChange={(event) => onUpdate(task.id, { status: event.target.value as TaskStatus })}>
            {TASK_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        )}
        <button className="secondary-action mini-action" type="button" onClick={onEdit}>Edit</button>
        <button className="secondary-action mini-action" type="button" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function TaskCalendar({ tasks, teamMembers, onSelectTask }: { tasks: EOTask[]; teamMembers: TeamMember[]; onSelectTask: (task: EOTask) => void }) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // Mobile only (see .task-calendar-agenda in styles.css) -- a 7-column
  // month grid has no room left for task-title chips once each cell is
  // phone-width, so cells become tap targets showing just a count badge,
  // and the tapped day's tasks list out below instead. Desktop keeps the
  // full grid with inline chips, untouched.
  const [selectedDay, setSelectedDay] = useState<number | null>(() => {
    const now = new Date();
    return now.getFullYear() === monthCursor.getFullYear() && now.getMonth() === monthCursor.getMonth() ? now.getDate() : null;
  });

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const tasksByDay = new Map<number, EOTask[]>();
  const undated: EOTask[] = [];
  tasks.forEach((task) => {
    if (!task.dueDate) {
      undated.push(task);
      return;
    }
    const parsed = new Date(`${task.dueDate}T00:00:00`);
    if (parsed.getFullYear() === year && parsed.getMonth() === month) {
      const day = parsed.getDate();
      tasksByDay.set(day, [...(tasksByDay.get(day) ?? []), task]);
    }
  });

  const cells: Array<number | null> = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  const selectedDayTasks = selectedDay !== null ? tasksByDay.get(selectedDay) ?? [] : [];

  function changeMonth(next: Date) {
    setMonthCursor(next);
    const now = new Date();
    setSelectedDay(now.getFullYear() === next.getFullYear() && now.getMonth() === next.getMonth() ? now.getDate() : null);
  }

  return (
    <div className="task-calendar">
      <div className="task-calendar-header">
        <button className="secondary-action mini-action" type="button" onClick={() => changeMonth(new Date(year, month - 1, 1))}>&lt;</button>
        <strong>{monthLabel}</strong>
        <button className="secondary-action mini-action" type="button" onClick={() => changeMonth(new Date(year, month + 1, 1))}>&gt;</button>
      </div>
      <div className="task-calendar-grid task-calendar-weekdays">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="task-calendar-grid">
        {cells.map((day, index) => {
          const dayTasks = day !== null ? tasksByDay.get(day) ?? [] : [];
          return (
            <button
              key={index}
              type="button"
              className={`task-calendar-cell ${day === null ? "is-empty" : ""} ${day === selectedDay ? "is-selected" : ""}`}
              disabled={day === null}
              onClick={() => day !== null && setSelectedDay(day)}
            >
              {day !== null && (
                <>
                  <span className="task-calendar-day">{day}</span>
                  {dayTasks.slice(0, 3).map((task) => (
                    <span
                      key={task.id}
                      className={`task-calendar-chip priority-${task.priority}`}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectTask(task);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.stopPropagation();
                          onSelectTask(task);
                        }
                      }}
                    >
                      {task.title}
                    </span>
                  ))}
                  {dayTasks.length > 3 && <span className="muted">+{dayTasks.length - 3} more</span>}
                  {dayTasks.length > 0 && <span className="task-calendar-day-count">{dayTasks.length}</span>}
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="task-calendar-agenda">
        <span className="task-calendar-agenda-label">
          {selectedDay === null ? "Tap a day to see its tasks" : `${monthCursor.toLocaleDateString(undefined, { month: "short" })} ${selectedDay} (${selectedDayTasks.length})`}
        </span>
        {selectedDayTasks.map((task) => (
          <button key={task.id} className="task-calendar-agenda-row" type="button" onClick={() => onSelectTask(task)}>
            <span className={priorityBadgeClass(task.priority)}>{task.priority}</span>
            <span>{task.title}</span>
            <small className="muted">{taskAssigneeLabel(task, teamMembers)}</small>
          </button>
        ))}
        {selectedDay !== null && selectedDayTasks.length === 0 && <div className="empty-compact-state">No tasks due this day.</div>}
      </div>
      {undated.length > 0 && (
        <div className="task-calendar-undated">
          <span className="muted">No due date ({undated.length}):</span>
          {undated.slice(0, 6).map((task) => (
            <button key={task.id} className="task-calendar-chip" type="button" onClick={() => onSelectTask(task)}>{task.title}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskGantt({ tasks, onSelectTask }: { tasks: EOTask[]; onSelectTask: (task: EOTask) => void }) {
  const datedTasks = tasks.filter((task) => task.dueDate);

  if (datedTasks.length === 0) {
    return <div className="empty-compact-state">No tasks with due dates yet -- generate a schedule or set dates to see a timeline.</div>;
  }

  const allTimes = datedTasks.flatMap((task) => [task.startDate || task.dueDate, task.dueDate]).map((date) => new Date(`${date}T00:00:00`).getTime());
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const spanDays = Math.max(1, Math.round((maxTime - minTime) / 86400000) + 1);

  function dayOffset(dateStr: string) {
    return (new Date(`${dateStr}T00:00:00`).getTime() - minTime) / 86400000;
  }

  const markerCount = Math.min(6, spanDays);
  const markers = Array.from({ length: markerCount }, (_, index) => {
    const dayIndex = Math.round((index / Math.max(1, markerCount - 1)) * (spanDays - 1));
    return {
      leftPct: (dayIndex / spanDays) * 100,
      label: new Date(minTime + dayIndex * 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    };
  });

  return (
    <div className="task-gantt">
      <div className="task-gantt-header">
        <div className="task-gantt-label-col">Task</div>
        <div className="task-gantt-track-col">
          {markers.map((marker, index) => (
            <span key={index} className="task-gantt-marker" style={{ left: `${marker.leftPct}%` }}>{marker.label}</span>
          ))}
        </div>
      </div>
      <div className="task-gantt-rows">
        {datedTasks.map((task) => {
          const start = task.startDate || task.dueDate;
          const startOffset = dayOffset(start);
          const endOffset = dayOffset(task.dueDate);
          const leftPct = (startOffset / spanDays) * 100;
          const widthPct = Math.max(2, ((endOffset - startOffset + 1) / spanDays) * 100);
          return (
            <div className="task-gantt-row" key={task.id}>
              <div className="task-gantt-label-col" title={task.title}>{task.title}</div>
              <div className="task-gantt-track-col">
                <button
                  type="button"
                  className={`task-gantt-bar status-${task.status}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  onClick={() => onSelectTask(task)}
                  title={`${task.title} (${start} -> ${task.dueDate})`}
                >
                  {task.title}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkloadStrip({ tasks, teamMembers, onSelectPerson }: { tasks: EOTask[]; teamMembers: TeamMember[]; onSelectPerson: (email: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = teamMembers
    .filter((member) => member.isActive && member.email)
    .map((member) => {
      const ownTasks = tasks.filter((task) => task.assigneeEmail && task.assigneeEmail.toLowerCase() === member.email.toLowerCase());
      const open = ownTasks.filter((task) => task.status !== "done").length;
      const overdue = ownTasks.filter((task) => task.status !== "done" && task.dueDate && task.dueDate < today).length;
      return { member, open, overdue };
    })
    .filter((row) => row.open > 0)
    .sort((a, b) => b.open - a.open);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="workload-strip">
      {rows.map(({ member, open, overdue }) => (
        <button key={member.id} className={`workload-chip ${overdue > 0 ? "has-overdue" : ""}`} type="button" onClick={() => onSelectPerson(member.email)}>
          <strong>{member.fullName}</strong>
          <span>{open} open{overdue > 0 ? `, ${overdue} overdue` : ""}</span>
        </button>
      ))}
    </div>
  );
}

function TasksBoard({
  tasks,
  taskActivity,
  projectSites,
  teamMembers,
  status,
  onCreate,
  onUpdate,
  onDelete,
  onRefresh,
  inventoryItems,
  taskHardwareDependencies,
  onAddTaskDependency,
  onDeleteTaskDependency,
  deletedTasks,
  onRestore,
  canReviewDeletedTasks,
  focusTask,
}: {
  tasks: EOTask[];
  taskActivity: TaskActivityEntry[];
  projectSites: ProjectSite[];
  teamMembers: TeamMember[];
  status: string;
  onCreate: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">) => Promise<boolean>;
  onUpdate: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => Promise<boolean>;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  inventoryItems?: Part[];
  taskHardwareDependencies?: TaskHardwareDependency[];
  onAddTaskDependency?: (taskId: string, sku: string, qty: number) => void;
  onDeleteTaskDependency?: (id: string) => void;
  deletedTasks?: EOTask[];
  onRestore?: (id: string) => Promise<boolean>;
  canReviewDeletedTasks?: boolean;
  focusTask?: { taskId: string; token: number } | null;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [sectionFilter, setSectionFilter] = useState<"all" | TaskSection>("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<"list" | "board" | "calendar" | "gantt">("list");
  const [groupBy, setGroupBy] = useState<TaskGroupBy>("status");
  const [personFilter, setPersonFilter] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);

  const filteredTasks = tasks.filter((task) =>
    (sectionFilter === "all" || task.section === sectionFilter) &&
    (!personFilter || (task.assigneeEmail && task.assigneeEmail.toLowerCase() === personFilter.toLowerCase()))
  );
  const groups = taskGroupDefs(groupBy, teamMembers, filteredTasks);

  function openAddModal() {
    setEditingId(null);
    setDraft(EMPTY_TASK_DRAFT);
    setModalOpen(true);
  }

  function openEditModal(task: EOTask) {
    setEditingId(task.id);
    setDraft({
      title: task.title,
      description: task.description,
      section: task.section,
      projectRef: task.projectRef,
      quoteId: task.quoteId,
      isInternal: task.isInternal,
      status: task.status,
      priority: task.priority,
      category: task.category,
      impactAreas: task.impactAreas,
      assigneeUserId: task.assigneeUserId,
      assigneeEmail: task.assigneeEmail,
      assignedRoleKey: task.assignedRoleKey,
      startDate: task.startDate,
      dueDate: task.dueDate,
    });
    setModalOpen(true);
  }

  // Clicking a task-related notification lands here with focusTask set --
  // open that task's edit modal directly instead of leaving the user to
  // find it themselves in the list.
  useEffect(() => {
    if (!focusTask) {
      return;
    }
    const task = tasks.find((entry) => entry.id === focusTask.taskId);
    if (task) {
      openEditModal(task);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTask?.token]);

  async function submitDraft() {
    if (!draft.title.trim()) {
      return false;
    }
    if (editingId) {
      return onUpdate(editingId, draft);
    }
    return onCreate(draft);
  }

  return (
    <div className="content-grid">
      <section className="panel wide">
        <PanelHeader title="Tasks" label="Work items across every section, by status, person, or group" />
        <WorkloadStrip tasks={tasks} teamMembers={teamMembers} onSelectPerson={(email) => { setPersonFilter(email); setGroupBy("assignee"); }} />
        {personFilter && (
          <div className="report-filter-row">
            <span className="muted">Showing only: {assigneeLabel(personFilter, teamMembers)}</span>
            <button className="secondary-action mini-action" type="button" onClick={() => setPersonFilter("")}>Clear person filter</button>
          </div>
        )}
        <div className="report-filter-row">
          <button className="primary-action mini-action" type="button" onClick={openAddModal}>
            <Plus size={14} /> Add Task
          </button>
          <button className="secondary-action mini-action" type="button" onClick={onRefresh}>Refresh</button>
          {canReviewDeletedTasks && (deletedTasks ?? []).length > 0 && (
            <button className="secondary-action mini-action" type="button" onClick={() => setShowDeleted((current) => !current)}>
              {showDeleted ? "Hide" : "Show"} Deleted ({(deletedTasks ?? []).length})
            </button>
          )}
          <div className="view-mode-tabs">
            <button className={`view-mode-tab ${viewMode === "list" ? "active" : ""}`} type="button" onClick={() => setViewMode("list")}>List</button>
            <button className={`view-mode-tab ${viewMode === "board" ? "active" : ""}`} type="button" onClick={() => setViewMode("board")}>Board</button>
            <button className={`view-mode-tab ${viewMode === "calendar" ? "active" : ""}`} type="button" onClick={() => setViewMode("calendar")}>Calendar</button>
            <button className={`view-mode-tab ${viewMode === "gantt" ? "active" : ""}`} type="button" onClick={() => setViewMode("gantt")}>Gantt</button>
          </div>
          <label className="inline-filter-field">Section
            <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value as "all" | TaskSection)}>
              <option value="all">All sections</option>
              {TASK_SECTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {viewMode !== "calendar" && viewMode !== "gantt" && (
            <label className="inline-filter-field">Group by
              <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as TaskGroupBy)}>
                <option value="status">Status</option>
                <option value="assignee">Individual</option>
                <option value="section">Section / Group</option>
              </select>
            </label>
          )}
          {status && <span className="muted">{status}</span>}
        </div>

        {canReviewDeletedTasks && showDeleted && (
          <div className="deleted-tasks-panel">
            <span className="deleted-tasks-label">Deleted Tasks</span>
            <p className="muted">Removed from the lists above, but kept on record -- who deleted it, when, and every change it had before that. Restore brings it back.</p>
            <table className="stack-table-mobile">
              <thead>
                <tr><th>Title</th><th>Section</th><th>Deleted by</th><th>Deleted at</th><th></th></tr>
              </thead>
              <tbody>
                {(deletedTasks ?? []).map((task) => (
                  <tr key={task.id}>
                    <td>{task.title}</td>
                    <td>{TASK_SECTION_OPTIONS.find((option) => option.value === task.section)?.label ?? task.section}</td>
                    <td>{task.deletedByEmail || "Unknown"}</td>
                    <td>{task.deletedAt ? new Date(task.deletedAt).toLocaleString() : "-"}</td>
                    <td>
                      {onRestore && (
                        <button className="secondary-action mini-action" type="button" onClick={() => onRestore(task.id)}>Restore</button>
                      )}
                    </td>
                  </tr>
                ))}
                {(deletedTasks ?? []).length === 0 && (
                  <tr><td colSpan={5} className="empty-compact-state">No deleted tasks.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {viewMode === "calendar" && (
          <TaskCalendar tasks={filteredTasks} teamMembers={teamMembers} onSelectTask={openEditModal} />
        )}

        {viewMode === "gantt" && (
          <TaskGantt tasks={filteredTasks} onSelectTask={openEditModal} />
        )}

        {viewMode === "list" && groups.map((group) => {
          const groupTasks = filteredTasks.filter((task) => taskMatchesGroup(task, groupBy, group.key));
          const isCollapsed = collapsedGroups[group.key] ?? false;
          return (
            <div className="task-status-group" key={group.key || "unassigned"}>
              <button
                className="task-status-group-header"
                type="button"
                onClick={() => setCollapsedGroups((current) => ({ ...current, [group.key]: !isCollapsed }))}
              >
                <span className={group.pillClass ?? "status-pill"}>{group.label}</span>
                <span className="muted">{groupTasks.length}</span>
              </button>
              {!isCollapsed && (
                <>
                <div className="tasks-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Section</th>
                      <th>Priority</th>
                      <th>Category</th>
                      <th>Impact</th>
                      <th>Assignee</th>
                      <th>Due</th>
                      <th>Source</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupTasks.map((task) => (
                      <tr key={task.id}>
                        <td>{task.title}</td>
                        <td>{TASK_SECTION_OPTIONS.find((option) => option.value === task.section)?.label ?? task.section}</td>
                        <td><span className={priorityBadgeClass(task.priority)}>{task.priority}</span></td>
                        <td>{task.category}</td>
                        <td>
                          {task.impactAreas.length > 0 ? (
                            <div className="tag-chip-row">{task.impactAreas.map((tag) => <span key={tag}>{tag}</span>)}</div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>{taskAssigneeLabel(task, teamMembers)}</td>
                        <td>{task.dueDate || "-"}</td>
                        <td>{task.isInternal ? "Internal" : task.projectRef || "External"}</td>
                        <td>
                          <select
                            value={task.status}
                            onChange={(event) => onUpdate(task.id, { status: event.target.value as TaskStatus })}
                          >
                            {TASK_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                          <button className="secondary-action mini-action" type="button" onClick={() => openEditModal(task)}>Edit</button>
                          <button className="secondary-action mini-action" type="button" onClick={() => onDelete(task.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                    {groupTasks.length === 0 && (
                      <tr>
                        <td colSpan={9} className="empty-compact-state">No tasks in this group.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>

                <div className="mobile-card-list">
                  {groupTasks.map((task) => (
                    <div key={task.id} className="mobile-card">
                      <span className="mobile-card-row">
                        <span className="mobile-card-title">
                          <strong>{task.title}</strong>
                          <small className="muted">{TASK_SECTION_OPTIONS.find((option) => option.value === task.section)?.label ?? task.section} &middot; {taskAssigneeLabel(task, teamMembers)}</small>
                        </span>
                        <span className={priorityBadgeClass(task.priority)}>{task.priority}</span>
                      </span>
                      <span className="mobile-card-meta">
                        {task.category}{task.dueDate ? ` · Due ${task.dueDate}` : ""} &middot; {task.isInternal ? "Internal" : task.projectRef || "External"}
                      </span>
                      {task.impactAreas.length > 0 && <span className="tag-chip-row">{task.impactAreas.map((tag) => <span key={tag}>{tag}</span>)}</span>}
                      <select
                        value={task.status}
                        onChange={(event) => onUpdate(task.id, { status: event.target.value as TaskStatus })}
                      >
                        {TASK_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <span className="mobile-card-pills">
                        <button className="secondary-action mini-action" type="button" onClick={() => openEditModal(task)}>Edit</button>
                        <button className="secondary-action mini-action" type="button" onClick={() => onDelete(task.id)}>Delete</button>
                      </span>
                    </div>
                  ))}
                  {groupTasks.length === 0 && <div className="empty-compact-state">No tasks in this group.</div>}
                </div>
                </>
              )}
            </div>
          );
        })}

        {viewMode === "board" && (
          <div className="task-board">
            {groups.map((group) => {
              const groupTasks = filteredTasks.filter((task) => taskMatchesGroup(task, groupBy, group.key));
              return (
                <div className="task-board-column" key={group.key || "unassigned"}>
                  <div className="task-board-column-header">
                    <span className={group.pillClass ?? "status-pill"}>{group.label}</span>
                    <span className="muted">{groupTasks.length}</span>
                  </div>
                  <div className="task-board-column-body">
                    {groupTasks.map((task) => (
                      <TaskCard key={task.id} task={task} teamMembers={teamMembers} onUpdate={onUpdate} onEdit={() => openEditModal(task)} onDelete={() => onDelete(task.id)} showStatusMove={groupBy === "status"} />
                    ))}
                    {groupTasks.length === 0 && <div className="empty-compact-state">No tasks.</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {modalOpen && (
        <TaskEditorModal
          draft={draft}
          setDraft={setDraft}
          editingId={editingId}
          editingTask={tasks.find((task) => task.id === editingId) ?? null}
          activityLog={taskActivity.filter((entry) => entry.taskId === editingId)}
          onQuickStatusChange={editingId ? (status) => onUpdate(editingId, { status }) : undefined}
          projectSites={projectSites}
          teamMembers={teamMembers}
          onSubmit={submitDraft}
          onClose={() => setModalOpen(false)}
          taskDependencies={(taskHardwareDependencies ?? []).filter((dep) => dep.taskId === editingId)}
          inventoryItems={inventoryItems}
          onAddDependency={editingId && onAddTaskDependency ? (sku, qty) => onAddTaskDependency(editingId, sku, qty) : undefined}
          onDeleteDependency={onDeleteTaskDependency}
        />
      )}
    </div>
  );
}

function TaskMiniPanel({
  title,
  tasks,
  taskActivity,
  teamMembers,
  projectSites,
  section,
  projectRef,
  isInternal,
  hideAdd,
  onCreate,
  onUpdate,
  onDelete,
  onOpenFull,
}: {
  title: string;
  tasks: EOTask[];
  taskActivity: TaskActivityEntry[];
  teamMembers: TeamMember[];
  projectSites: ProjectSite[];
  section?: TaskSection;
  projectRef?: string;
  isInternal?: boolean;
  hideAdd?: boolean;
  onCreate: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdByEmail" | "createdAt" | "completedAt" | "closedByEmail" | "closedAt" | "deletedByEmail" | "deletedAt">) => Promise<boolean>;
  onUpdate: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => Promise<boolean>;
  onDelete: (id: string) => void;
  onOpenFull: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [showAll, setShowAll] = useState(false);
  const openTasks = tasks.filter((task) => task.status !== "done");
  const priorityRank: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const sortedOpenTasks = [...openTasks].sort((a, b) => {
    const priorityDiff = (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    if (a.dueDate && b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    if (a.dueDate) {
      return -1;
    }
    if (b.dueDate) {
      return 1;
    }
    return 0;
  });
  const visibleTasks = showAll ? sortedOpenTasks : sortedOpenTasks.slice(0, 5);

  function openAddModal() {
    setEditingId(null);
    setDraft({ ...EMPTY_TASK_DRAFT, section: section ?? EMPTY_TASK_DRAFT.section, projectRef: projectRef ?? "", isInternal: isInternal ?? true });
    setModalOpen(true);
  }

  function openEditModal(task: EOTask) {
    setEditingId(task.id);
    setDraft({
      title: task.title,
      description: task.description,
      section: task.section,
      projectRef: task.projectRef,
      quoteId: task.quoteId,
      isInternal: task.isInternal,
      status: task.status,
      priority: task.priority,
      category: task.category,
      impactAreas: task.impactAreas,
      assigneeUserId: task.assigneeUserId,
      assigneeEmail: task.assigneeEmail,
      assignedRoleKey: task.assignedRoleKey,
      startDate: task.startDate,
      dueDate: task.dueDate,
    });
    setModalOpen(true);
  }

  async function submitDraft() {
    if (!draft.title.trim()) {
      return false;
    }
    if (editingId) {
      return onUpdate(editingId, draft);
    }
    return onCreate(draft);
  }

  return (
    <section className="panel task-mini-panel wide">
      <div className="panel-title-row">
        <div>
          <h2>{title}</h2>
          <p>{openTasks.length} open{tasks.length !== openTasks.length ? `, ${tasks.length - openTasks.length} done` : ""}</p>
        </div>
        {!hideAdd && (
          <div className="action-row">
            <button className="primary-action mini-action" type="button" onClick={openAddModal}><Plus size={14} /> Add</button>
          </div>
        )}
      </div>
      <div className="task-mini-list">
        {visibleTasks.map((task) => (
          <button key={task.id} className="task-mini-row" type="button" onClick={() => openEditModal(task)}>
            <span className={`status-pill status-${task.status}`}>{TASK_STATUS_OPTIONS.find((option) => option.value === task.status)?.label ?? task.status}</span>
            <span className="task-mini-row-title">{task.title}</span>
            <span className="muted">{taskAssigneeLabel(task, teamMembers)}</span>
            {task.dueDate && <span className="muted">{task.dueDate}</span>}
          </button>
        ))}
        {visibleTasks.length === 0 && <div className="empty-compact-state">No open tasks.</div>}
        {!showAll && openTasks.length > 5 && (
          <button className="secondary-action mini-action" type="button" onClick={() => setShowAll(true)}>Show all open ({openTasks.length})</button>
        )}
      </div>
      {modalOpen && (
        <TaskEditorModal
          draft={draft}
          setDraft={setDraft}
          editingId={editingId}
          editingTask={tasks.find((task) => task.id === editingId) ?? null}
          activityLog={taskActivity.filter((entry) => entry.taskId === editingId)}
          onQuickStatusChange={editingId ? (status) => onUpdate(editingId, { status }) : undefined}
          projectSites={projectSites}
          teamMembers={teamMembers}
          onSubmit={submitDraft}
          onClose={() => setModalOpen(false)}
          lockSection
          lockProjectRef={projectRef !== undefined}
        />
      )}
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <section className="metric"><div>{icon}</div><span>{label}</span><strong>{value}</strong></section>;
}

function PanelHeader({
  title,
  label,
  collapsed,
  onToggleCollapse,
  onEdit,
}: {
  title: string;
  label: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onEdit?: () => void;
}) {
  return (
    <header className="panel-header">
      <div><h2>{title}</h2><p>{label}</p></div>
      {onToggleCollapse ? (
        <button className="icon-button" type="button" onClick={onToggleCollapse} aria-label={collapsed ? "Expand section" : "Collapse section"}>
          {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
      ) : onEdit ? (
        <button className="icon-button" type="button" onClick={onEdit} aria-label="Edit">
          <FileText size={18} />
        </button>
      ) : (
        <FileText size={18} />
      )}
    </header>
  );
}

// Public, no-login client view for a single Submittal. Reached via
// ?submittal=<token> on the root URL (no server-side routing needed since
// it's still index.html) and rendered instead of <App/> entirely -- it never
// touches auth state and talks to Supabase only through the anon-key RPCs.
type SubmittalResponseStatus = "approved" | "rejected" | "revision_requested";

function SubmittalPublicPage({ token }: { token: string }) {
  const [phase, setPhase] = useState<"loading" | "error" | "ready" | "responded">("loading");
  const [data, setData] = useState<PublicSubmittalView | null>(null);
  const [approverName, setApproverName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [respondedStatus, setRespondedStatus] = useState<SubmittalResponseStatus | null>(null);

  useEffect(() => {
    fetchPublicSubmittal(token)
      .then((result) => {
        if (!result) {
          setPhase("error");
          return;
        }
        setData(result);
        if (result.status === "sent") {
          setPhase("ready");
        } else {
          setPhase("responded");
          if (result.status === "approved" || result.status === "rejected" || result.status === "revision_requested") {
            setRespondedStatus(result.status);
          }
        }
      })
      .catch(() => setPhase("error"));
  }, [token]);

  async function respond(newStatus: SubmittalResponseStatus) {
    if (!approverName.trim()) {
      setSubmitError("Please enter your name before responding.");
      return;
    }
    setSubmitError("");
    setSubmitting(true);
    const ok = await respondToPublicSubmittal(token, newStatus, approverName.trim(), notes.trim());
    setSubmitting(false);
    if (ok) {
      setRespondedStatus(newStatus);
      setPhase("responded");
    } else {
      setSubmitError("Could not submit your response. Please try again or contact your Ergon representative.");
    }
  }

  if (phase === "loading") {
    return (
      <div className="submittal-public-page">
        <p>Loading submittal...</p>
      </div>
    );
  }

  if (phase === "error" || !data) {
    return (
      <div className="submittal-public-page">
        <h1>Link not found</h1>
        <p>This submittal link is invalid or has expired. Please contact your Ergon representative for a new link.</p>
      </div>
    );
  }

  const snapshot = data.contentSnapshot;

  return (
    <div className="submittal-public-page">
      <header className="submittal-public-header">
        <h1>{snapshot.projectName}</h1>
        <p>Submittal v{data.version}{snapshot.clientName ? ` - ${snapshot.clientName}` : ""}</p>
      </header>

      {phase === "responded" && respondedStatus && (
        <div className={`submittal-response-banner submittal-status-${respondedStatus}`}>
          {respondedStatus === "approved" && "Thank you - this submittal has been approved."}
          {respondedStatus === "rejected" && "This submittal has been marked as rejected. Your Ergon representative will follow up."}
          {respondedStatus === "revision_requested" && "Thanks - a revision has been requested. Your Ergon representative will follow up."}
        </div>
      )}

      <section className="submittal-public-section">
        <h2>Scope of Work</h2>
        <p><strong>Summary:</strong> {snapshot.sow.summary || "-"}</p>
        <p><strong>Preparation:</strong> {snapshot.sow.preparation || "-"}</p>
        <p><strong>Infrastructure:</strong> {snapshot.sow.infrastructure || "-"}</p>
        <p><strong>Installation:</strong> {snapshot.sow.installation || "-"}</p>
        <p><strong>Commissioning:</strong> {snapshot.sow.commissioning || "-"}</p>
        <p><strong>Fine tuning / go-live:</strong> {snapshot.sow.fineTuning || "-"}</p>
        <p><strong>Assumptions:</strong> {snapshot.sow.assumptions || "-"}</p>
        <p><strong>Exclusions:</strong> {snapshot.sow.exclusions || "-"}</p>
      </section>

      <section className="submittal-public-section">
        <h2>Bill of Material</h2>
        <table className="stack-table-mobile">
          <thead><tr><th>Item</th><th>Qty</th></tr></thead>
          <tbody>
            {snapshot.bom.map((line, index) => (
              <tr key={`${line.item}-${index}`}><td>{line.item}</td><td>{line.qty}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      {phase === "ready" && (
        <section className="submittal-public-section submittal-response-form">
          <h2>Your Response</h2>
          <label>Your name<input value={approverName} onChange={(event) => setApproverName(event.target.value)} /></label>
          <label>Notes (optional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          {submitError && <small className="error-text">{submitError}</small>}
          <div className="submittal-response-actions">
            <button type="button" className="primary-action" disabled={submitting} onClick={() => respond("approved")}>Approve</button>
            <button type="button" className="secondary-action" disabled={submitting} onClick={() => respond("revision_requested")}>Request Revision</button>
            <button type="button" className="secondary-action" disabled={submitting} onClick={() => respond("rejected")}>Reject</button>
          </div>
        </section>
      )}
    </div>
  );
}

// Public, no-login client view for a Quote Proposal. Reached via
// ?proposal=<token> on the root URL, same pattern as SubmittalPublicPage
// above -- anon-key RPCs only, no auth state. v1 has no generated PDF file;
// the "Print / Save as PDF" button below just calls window.print() against
// a dedicated print stylesheet (see styles.css .proposal-public-page
// @media print rules), which is the agreed amount of scope for now.
type ProposalResponseStatus = "approved" | "rejected" | "revision_requested";

function ProposalPublicPage({ token }: { token: string }) {
  const [phase, setPhase] = useState<"loading" | "error" | "ready" | "responded">("loading");
  const [data, setData] = useState<PublicQuoteProposalView | null>(null);
  const [approverName, setApproverName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [respondedStatus, setRespondedStatus] = useState<ProposalResponseStatus | null>(null);

  useEffect(() => {
    fetchPublicQuoteProposal(token)
      .then((result) => {
        if (!result) {
          setPhase("error");
          return;
        }
        setData(result);
        if (result.status === "sent") {
          setPhase("ready");
        } else {
          setPhase("responded");
          if (result.status === "approved" || result.status === "rejected" || result.status === "revision_requested") {
            setRespondedStatus(result.status);
          }
        }
      })
      .catch(() => setPhase("error"));
  }, [token]);

  async function respond(newStatus: ProposalResponseStatus) {
    if (!approverName.trim()) {
      setSubmitError("Please enter your name before responding.");
      return;
    }
    setSubmitError("");
    setSubmitting(true);
    const ok = await respondToPublicQuoteProposal(token, newStatus, approverName.trim(), notes.trim());
    setSubmitting(false);
    if (ok) {
      setRespondedStatus(newStatus);
      setPhase("responded");
    } else {
      setSubmitError("Could not submit your response. Please try again or contact your Ergon representative.");
    }
  }

  if (phase === "loading") {
    return (
      <div className="submittal-public-page">
        <p>Loading proposal...</p>
      </div>
    );
  }

  if (phase === "error" || !data) {
    return (
      <div className="submittal-public-page">
        <h1>Link not found</h1>
        <p>This proposal link is invalid or has expired. Please contact your Ergon representative for a new link.</p>
      </div>
    );
  }

  const snapshot = data.contentSnapshot;

  return (
    <div className="submittal-public-page proposal-public-page">
      <div className="proposal-print-actions">
        <button type="button" className="secondary-action mini-action" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <header className="submittal-public-header">
        <h1>{snapshot.siteName}</h1>
        <p>Proposal v{data.version}{snapshot.clientName ? ` - ${snapshot.clientName}` : ""}{snapshot.city ? ` - ${snapshot.city}` : ""}</p>
        {snapshot.quoteRef && <p className="muted">Reference {snapshot.quoteRef}</p>}
      </header>

      {phase === "responded" && respondedStatus && (
        <div className={`submittal-response-banner submittal-status-${respondedStatus}`}>
          {respondedStatus === "approved" && "Thank you - this proposal has been approved."}
          {respondedStatus === "rejected" && "This proposal has been marked as rejected. Your Ergon representative will follow up."}
          {respondedStatus === "revision_requested" && "Thanks - a revision has been requested. Your Ergon representative will follow up."}
        </div>
      )}

      {snapshot.proposalSummary && (
        <section className="submittal-public-section">
          <h2>Executive Summary</h2>
          <p>{snapshot.proposalSummary}</p>
        </section>
      )}

      <section className="submittal-public-section">
        <h2>Pricing &amp; Bill of Material</h2>
        <table className="proposal-bom-table stack-table-mobile">
          <thead><tr><th></th><th>Item</th><th>Description</th><th>Qty</th><th>Datasheet</th></tr></thead>
          <tbody>
            {snapshot.bom.map((line, index) => (
              <tr key={`${line.item}-${index}`}>
                <td>{line.imageUrl ? <img className="proposal-bom-thumb" src={line.imageUrl} alt={line.item} /> : null}</td>
                <td><strong>{line.item}</strong>{line.manufacturer ? <span className="muted"> - {line.manufacturer}</span> : null}</td>
                <td>{line.description || line.notes || "-"}</td>
                <td>{line.qty}</td>
                <td>{line.hasDatasheet ? <a href={line.datasheetUrl} target="_blank" rel="noreferrer">View datasheet</a> : "-"}</td>
              </tr>
            ))}
            {snapshot.bom.length === 0 && (
              <tr><td colSpan={5} className="empty-compact-state">No line items on this proposal.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {snapshot.templateSections.map((section) => (
        <section className="submittal-public-section" key={section.title}>
          <h2>{section.title}</h2>
          {section.body.split("\n").map((paragraph, index) => (
            paragraph.trim() ? <p key={index}>{paragraph}</p> : <br key={index} />
          ))}
        </section>
      ))}

      {phase === "ready" && (
        <section className="submittal-public-section submittal-response-form proposal-no-print">
          <h2>Your Response</h2>
          <label>Your name<input value={approverName} onChange={(event) => setApproverName(event.target.value)} /></label>
          <label>Notes (optional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          {submitError && <small className="error-text">{submitError}</small>}
          <div className="submittal-response-actions">
            <button type="button" className="primary-action" disabled={submitting} onClick={() => respond("approved")}>Approve</button>
            <button type="button" className="secondary-action" disabled={submitting} onClick={() => respond("revision_requested")}>Request Revision</button>
            <button type="button" className="secondary-action" disabled={submitting} onClick={() => respond("rejected")}>Reject</button>
          </div>
        </section>
      )}
    </div>
  );
}

// Public, pre-login landing page for a real invite. Reached via
// ?invite=<token> on the root URL and rendered instead of <App/> entirely,
// same pattern as SubmittalPublicPage above -- it talks to Supabase only
// through the anon-key get_invite_by_token RPC until the person actually
// signs up, at which point it uses their brand-new session to call
// accept_invite (which assigns the roles the admin picked and auto-approves
// the account, skipping the Pending Approvals queue).
function InviteLandingPage({ token }: { token: string }) {
  const [phase, setPhase] = useState<"loading" | "error" | "used" | "ready" | "submitting" | "done">("loading");
  const [invite, setInvite] = useState<PublicInviteView | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    fetchInviteByToken(token)
      .then((result) => {
        if (!result) {
          setPhase("error");
          return;
        }
        setInvite(result);
        setFullName(result.fullName);
        setPhase(result.status === "pending" ? "ready" : "used");
      })
      .catch(() => setPhase("error"));
  }, [token]);

  async function handleAcceptWithPassword() {
    if (!invite) {
      return;
    }
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }
    setFormError("");
    setPhase("submitting");
    try {
      const session = await signUpWithPassword(invite.email, password);
      if (!session) {
        // Project has "confirm email" enabled, so there's no session yet to
        // call accept_invite with. Stash the token so the normal sign-in
        // gate can finish applying it once they confirm and sign in for
        // real -- otherwise this invite would silently never get applied.
        window.localStorage.setItem("pendingInviteToken", token);
        setFormError("Account created. Check your email to confirm it, then come back and sign in -- your invite will finish applying automatically.");
        setPhase("ready");
        return;
      }
      const accepted = await acceptInvite(token, session.accessToken);
      if (!accepted) {
        setFormError("Signed up, but could not apply your invited role. Contact your admin.");
        setPhase("ready");
        return;
      }
      setPhase("done");
      window.location.href = "/";
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create your account.");
      setPhase("ready");
    }
  }

  function handleAcceptWithGoogle() {
    window.sessionStorage.setItem("pendingInviteToken", token);
    signInWithGoogleRedirect();
  }

  if (phase === "loading") {
    return (
      <div className="submittal-public-page">
        <p>Loading your invite...</p>
      </div>
    );
  }

  if (phase === "error" || !invite) {
    return (
      <div className="submittal-public-page">
        <h1>Invite not found</h1>
        <p>This invite link is invalid or has expired. Please ask whoever invited you to send a new one.</p>
      </div>
    );
  }

  if (phase === "used") {
    return (
      <div className="submittal-public-page">
        <h1>{invite.status === "accepted" ? "Already accepted" : "Invite revoked"}</h1>
        <p>
          {invite.status === "accepted"
            ? "This invite has already been used to create an account. If that wasn't you, contact your admin."
            : "This invite has been revoked. Please ask whoever invited you to send a new one."}
        </p>
      </div>
    );
  }

  const roleLabel = ROLE_KEY_OPTIONS.find((option) => option.value === invite.primaryRole)?.label ?? invite.primaryRole;

  return (
    <div className="submittal-public-page">
      <header className="submittal-public-header">
        <h1>Welcome{invite.fullName ? ` ${invite.fullName}` : ""}</h1>
        <p>You've been invited to join the <strong>{roleLabel}</strong> team.</p>
      </header>
      <section className="submittal-public-section submittal-response-form">
        <h2>Set up your account</h2>
        <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
        <label>Email<input value={invite.email} disabled /></label>
        <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" /></label>
        <label>Confirm password<input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" /></label>
        {formError && <small className="error-text">{formError}</small>}
        <div className="submittal-response-actions">
          <button type="button" className="primary-action" disabled={phase === "submitting" || !password || !confirmPassword} onClick={handleAcceptWithPassword}>
            {phase === "submitting" ? "Creating account..." : "Create account & accept invite"}
          </button>
        </div>
        <div className="auth-gate-divider">or</div>
        <button type="button" className="secondary-action auth-gate-google" onClick={handleAcceptWithGoogle}>Continue with Google</button>
      </section>
    </div>
  );
}

// Without this, any uncaught render error anywhere in the tree unmounts
// the whole app to a blank white page with zero indication anything went
// wrong -- the person just sees nothing and has no way to tell "reload"
// would fix it. This turns that into a visible, actionable message.
class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Ergon crashed:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="auth-gate">
          <div className="auth-gate-card">
            <h2>Something went wrong</h2>
            <p className="muted">The page hit an error and couldn't continue. Reloading usually fixes it.</p>
            <button className="primary-action" type="button" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const submittalToken = new URLSearchParams(window.location.search).get("submittal");
const proposalToken = new URLSearchParams(window.location.search).get("proposal");
const inviteToken = new URLSearchParams(window.location.search).get("invite");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      {inviteToken ? (
        <InviteLandingPage token={inviteToken} />
      ) : submittalToken ? (
        <SubmittalPublicPage token={submittalToken} />
      ) : proposalToken ? (
        <ProposalPublicPage token={proposalToken} />
      ) : (
        <App />
      )}
    </RootErrorBoundary>
  </StrictMode>
);
