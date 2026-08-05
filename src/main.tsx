import { StrictMode, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import * as XLSX from "xlsx";
import {
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarDays,
  Camera,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  DollarSign,
  ExternalLink,
  FileText,
  FolderOpen,
  Image,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  Upload,
  User,
} from "lucide-react";
import {
  isRemotePersistenceConfigured,
  acquireTransactionLock,
  addFormSchemaField,
  addScheduleTemplatePhase,
  addTaskHardwareDependency,
  buildDocumentStoragePath,
  checkIsAdmin,
  consumeOAuthRedirectSession,
  bulkCreateCatalogItems,
  createCatalogItem,
  createHandover,
  createNotification,
  createPresalesRule,
  addSalesQuoteLocation,
  addSalesQuoteLocationImage,
  createProjectDocuments,
  createPurchaseOrder,
  createPurchaseRequestRemote,
  createSalesQuote,
  createScheduleTemplate,
  createSubmittal,
  createSubmittalShareToken,
  createTask,
  createTeamMember,
  ensureTeamMemberForSelf,
  deleteFormSchemaField,
  deletePresalesRule,
  deleteScheduleTemplatePhase,
  deleteTask,
  deleteTaskHardwareDependency,
  ensureOwnApprovalRequest,
  fetchPublicSubmittal,
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
  loadOwnApprovalStatus,
  loadNotificationRules,
  loadNotifications,
  loadPresalesRules,
  loadProjectDocuments,
  loadProjectSites,
  loadPurchaseOrders,
  loadPurchaseRequests,
  loadSalesQuotes,
  loadRemoteAppState,
  loadScheduleTemplates,
  loadStandardInstallTimes,
  loadSubmittalsForProject,
  loadTaskHardwareDependencies,
  loadTasks,
  loadTeamMembers,
  loadUserRoleMode,
  makeCatalogNumber,
  markAllNotificationsRead,
  markNotificationRead,
  refreshAuthSession,
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
  setUserRole,
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
  updatePurchaseOrderStatus,
  updatePurchaseRequestRemote,
  updateSalesQuoteLocation,
  updateTask,
  updateTaskHardwareDependencyStatus,
  updateTeamMember,
  upsertKnownUser,
  upsertStandardInstallTime,
  uploadDocumentFile,
  type ApprovalStatus,
  type AuthSession,
  type BomLine,
  type BuildComponent,
  type BuildRecipe,
  type BuildTransaction,
  type CatalogItem,
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
  type ProjectSubmittal,
  type PublicSubmittalView,
  type PurchaseLineCategory,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseRequest,
  type PurchaseUrl,
  type SalesQuote,
  type SalesQuoteLocation,
  type SalesQuoteLocationImage,
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
  type UserStatus,
} from "./persistence";
import "./styles.css";

type View = "dashboard" | "purchasing" | "inventory" | "projects" | "sales" | "tasks" | "reports" | "admin";

// PurchaseUrl, PriceHistoryEntry, and Part used to be defined locally; as of
// Phase 10c they're imported from persistence.ts (see the import block
// above) since inventory items are now backed by the real `inventory_items`
// / `inventory_balances` tables instead of the app_records blob.

const inventoryTags = ["VPU Part", "Edge Box Part", "Solar Part", "Server Part", "Network Part", "Power Part", "Field Hardware"];

// BuildComponent and BuildRecipe used to be defined locally; as of Phase 10d
// they're imported from persistence.ts (see the import block above) since
// equipment recipes are now backed by the real `equipment_types` /
// `equipment_bom_components` tables instead of the app_records blob.

type RoleMode = "warehouse" | "purchasing" | "pm" | "manager";

const ALL_TABS: View[] = ["dashboard", "purchasing", "inventory", "projects", "sales", "tasks", "reports"];

const TAB_LABELS: Record<View, string> = {
  dashboard: "Dashboard",
  purchasing: "Purchasing",
  inventory: "Inventory",
  projects: "Projects",
  sales: "Sales",
  tasks: "Tasks",
  reports: "Reports",
  admin: "Admin",
};

// Starting point when a role has no explicit per-user tab override. An admin
// can grant/restrict any individual user's exact tab list from the Admin page
// regardless of these defaults.
const DEFAULT_TABS_BY_ROLE: Record<RoleMode, View[]> = {
  warehouse: ["dashboard", "inventory", "projects", "tasks"],
  purchasing: ["dashboard", "purchasing", "inventory", "tasks", "reports"],
  pm: ["dashboard", "projects", "inventory", "sales", "tasks", "reports"],
  manager: ["dashboard", "purchasing", "inventory", "projects", "sales", "tasks", "reports"],
};

const TASK_SECTION_OPTIONS: Array<{ value: TaskSection; label: string }> = [
  { value: "warehouse", label: "Warehouse" },
  { value: "purchasing", label: "Purchasing" },
  { value: "inventory", label: "Inventory" },
  { value: "projects", label: "Projects" },
  { value: "sales_catalog", label: "Sales - Product Catalog" },
  { value: "sales_quotes", label: "Sales - Quote Builder" },
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

const IMPACT_AREA_OPTIONS = ["Inventory", "Purchasing", "Sales", "Projects", "Reports", "Other"];
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
    status: "Purchasing",
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
    status: "Purchasing",
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
  return ["dashboard", "purchasing", "inventory", "projects", "sales", "tasks", "reports", "admin"].includes(viewKey) ? (viewKey as View) : "dashboard";
}

function savedView() {
  const savedHash = window.localStorage.getItem("ergon:lastHash");
  return savedHash ? viewFromHash(savedHash) : "dashboard";
}

function scrollKey(hash = window.location.hash) {
  return `ergon:scroll:${hash || "#dashboard"}`;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function isArray<T>(value: unknown, fallback: T[]) {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function App() {
  const localState = loadLocalAppState();
  const [view, setView] = useState<View>(() => (window.location.hash ? viewFromHash() : savedView()));
  const [locationHash, setLocationHash] = useState(window.location.hash || window.localStorage.getItem("ergon:lastHash") || "#dashboard");
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (isRemotePersistenceConfigured() ? "loading" : "local"));
  const [isAdmin, setIsAdmin] = useState(false);
  const [knownUsers, setKnownUsers] = useState<KnownUser[]>([]);
  const [userRoleMap, setUserRoleMap] = useState<Record<string, string>>({});
  const [adminIds, setAdminIds] = useState<string[]>([]);
  const [adminStatus, setAdminStatus] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
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
  const [taskStatusMessage, setTaskStatusMessage] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMemberStatus, setTeamMemberStatus] = useState("");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationRules, setNotificationRules] = useState<NotificationRule[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [standardInstallTimes, setStandardInstallTimes] = useState<StandardInstallTime[]>([]);
  const [scheduleTemplates, setScheduleTemplates] = useState<ScheduleTemplate[]>([]);
  const [scheduleStatus, setScheduleStatus] = useState("");
  const [submittals, setSubmittals] = useState<ProjectSubmittal[]>([]);
  const [submittalStatus, setSubmittalStatus] = useState("");
  const [handoverSchema, setHandoverSchema] = useState<FormSchema | null>(null);
  const [formBuilderStatus, setFormBuilderStatus] = useState("");
  const [handovers, setHandovers] = useState<ProjectHandover[]>([]);
  const [handoverStatus, setHandoverStatus] = useState("");
  const [presalesRules, setPresalesRules] = useState<PresalesHardwareRule[]>([]);
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
      .then((session) => {
        if (session && !cancelled) {
          setAuthSession(session);
          setAuthStatus(`Signed in as ${session.email}.`);
          setSyncStatus("loading");
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
          if (!file) {
            return doc;
          }
          const storagePath = buildDocumentStoragePath(doc.project, doc.name);
          const uploaded = await uploadDocumentFile(file, storagePath, authSession.accessToken);
          return uploaded ? { ...doc, storage: "Supabase Storage" as const, storagePath } : doc;
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
    window.open(url, "_blank", "noopener,noreferrer");
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

  function reloadAdminDirectory(accessToken: string) {
    Promise.all([loadAllKnownUsers(accessToken), loadAllUserRoles(accessToken), loadAllAdmins(accessToken), loadAllAllowedViews(accessToken)])
      .then(([users, roles, admins, allowedViews]) => {
        setKnownUsers(users);
        setUserRoleMap(roles);
        setAdminIds(admins);
        setAllowedViewsMap(allowedViews);
      })
      .catch(() => setAdminStatus("Could not load the user directory."));
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
      loadOwnAllowedViews(authSession.userId, authSession.accessToken),
      ensureOwnApprovalRequest(authSession.userId, authSession.accessToken).then(() =>
        loadOwnApprovalStatus(authSession.userId, authSession.accessToken),
      ),
    ]).then(([adminFlag, savedRole, allowedViews, status]) => {
      if (cancelled) {
        return;
      }
      setIsAdmin(adminFlag);
      const resolvedRole = savedRole && ["warehouse", "purchasing", "pm", "manager"].includes(savedRole) ? (savedRole as RoleMode) : null;
      if (resolvedRole) {
        setRoleMode(resolvedRole);
      }
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
      await setUserRole(userId, roleKey, authSession.accessToken);
      setUserRoleMap((current) => ({ ...current, [userId]: roleKey }));
      setAdminStatus("Role updated.");
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : "Could not update role.");
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

  // Sales Quote Builder (migration 033). Loaded once per session, same
  // per-row create/update pattern as Purchase Orders/Requests.
  function reloadSalesQuotes(accessToken: string) {
    loadSalesQuotes(accessToken)
      .then(setSalesQuotes)
      .catch(() => setSalesQuoteStatus("Could not load sales quotes."));
  }

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setSalesQuotes([]);
      return;
    }
    reloadSalesQuotes(authSession.accessToken);
  }, [authSession]);

  async function handleCreateSalesQuote(input: { clientName: string; siteName: string; city: string; garageCount: number; lotCount: number }) {
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

  async function handleUploadSalesQuoteImage(quoteId: string, locationId: string, imageType: "photo" | "drawing", file: File) {
    if (!authSession) {
      return;
    }
    const image = await addSalesQuoteLocationImage(locationId, imageType, file, authSession.accessToken);
    if (image) {
      setSalesQuotes((current) =>
        current.map((entry) =>
          entry.id === quoteId
            ? { ...entry, locations: entry.locations.map((location) => (location.id === locationId ? { ...location, images: [...location.images, image] } : location)) }
            : entry,
        ),
      );
    }
  }

  async function handleDownloadSalesQuoteImage(image: SalesQuoteLocationImage) {
    if (!authSession) {
      return;
    }
    const url = await getQuoteImageDownloadUrl(image.storagePath, authSession.accessToken);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function reloadTasks(accessToken: string) {
    loadTasks(accessToken)
      .then(setTasks)
      .catch(() => setTaskStatusMessage("Could not load tasks."));
  }

  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setTasks([]);
      return;
    }
    reloadTasks(authSession.accessToken);
  }, [authSession]);

  async function handleCreateTask(task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">) {
    if (!authSession) {
      return;
    }
    try {
      const created = await createTask(task, authSession.userId, authSession.accessToken);
      setTasks((current) => [created, ...current]);
      setTaskStatusMessage(`${created.title} added.`);
      if (created.assigneeEmail) {
        notify("task_assigned", created.assigneeEmail, "New task assigned", `"${created.title}" was assigned to you.`, "task", created.id, `task_assigned:${created.id}:${created.assigneeEmail}`);
      }
    } catch (error) {
      setTaskStatusMessage(error instanceof Error ? error.message : "Could not create task.");
    }
  }

  async function handleUpdateTask(id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) {
    if (!authSession) {
      return;
    }
    try {
      const previous = tasks.find((existing) => existing.id === id);
      const updated = await updateTask(id, task, authSession.accessToken);
      setTasks((current) => current.map((existing) => (existing.id === id ? updated : existing)));
      setTaskStatusMessage(`${updated.title} updated.`);
      if (updated.assigneeEmail && updated.assigneeEmail !== previous?.assigneeEmail) {
        notify("task_assigned", updated.assigneeEmail, "Task assigned", `"${updated.title}" was assigned to you.`, "task", updated.id, `task_assigned:${updated.id}:${updated.assigneeEmail}`);
      }
      if (updated.status === "in_progress" && previous?.status !== "in_progress") {
        runTaskHardwareAutomation(updated);
      }
    } catch (error) {
      setTaskStatusMessage(error instanceof Error ? error.message : "Could not update task.");
    }
  }

  async function handleDeleteTask(id: string) {
    if (!authSession) {
      return;
    }
    await deleteTask(id, authSession.accessToken);
    setTasks((current) => current.filter((task) => task.id !== id));
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
    if (!authSession || !recipientEmail || !ruleActive(eventType, "in_app")) {
      return;
    }
    await createNotification({ recipientEmail, eventType, title, body, relatedEntityType, relatedEntityId, dedupeKey }, authSession.accessToken).catch(() => {});
    if (recipientEmail.toLowerCase() === authSession.email?.toLowerCase()) {
      reloadNotifications(authSession.email, authSession.accessToken);
    }
  }

  async function handleMarkNotificationRead(id: string) {
    if (!authSession) {
      return;
    }
    setNotifications((current) => current.map((entry) => (entry.id === id ? { ...entry, isRead: true } : entry)));
    await markNotificationRead(id, authSession.accessToken).catch(() => {});
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
      return;
    }
    loadStandardInstallTimes(authSession.accessToken).then(setStandardInstallTimes).catch(() => {});
    loadScheduleTemplates(authSession.accessToken).then(setScheduleTemplates).catch(() => {});
  }, [authSession]);

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
  function generateScheduleTasks(project: ProjectSite, template: ScheduleTemplate): Array<Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">> {
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
        isInternal: false,
        status: "to_do" as TaskStatus,
        priority: "normal" as TaskPriority,
        category: phase.defaultRole || "",
        impactAreas: [],
        assigneeUserId: null,
        assigneeEmail: "",
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

  // Phase 18: fluid forms engine + After-Sales Handover. Loaded once per
  // auth session, same as schedule templates/standard times.
  useEffect(() => {
    if (!authSession || !isRemotePersistenceConfigured()) {
      setHandoverSchema(null);
      setPresalesRules([]);
      setTaskHardwareDependencies([]);
      return;
    }
    loadFormSchema("after_sales_handover", authSession.accessToken).then(setHandoverSchema).catch(() => {});
    loadPresalesRules(authSession.accessToken).then(setPresalesRules).catch(() => {});
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
  // against a tier/node-count/cloud-sync questionnaire and writes ordinary
  // project_bom_lines-equivalent rows -- for tonight, since Phase 10's BOM
  // cutover hasn't happened, that means appending to the same blob-backed
  // `project.bom` the manual "Add Material" button already writes to.
  function evaluatePresalesRules(tier: string, nodeCount: number, cloudSync: boolean) {
    return presalesRules
      .filter((rule) => rule.isActive && rule.tier === tier)
      .filter((rule) => rule.requiresCloudSync === null || rule.requiresCloudSync === cloudSync)
      .map((rule) => ({
        item: rule.baseItemName,
        qty: rule.quantityMode === "per_node_ceil" ? Math.max(1, Math.ceil(nodeCount / Math.max(1, rule.perNodeDivisor ?? 1))) : Math.round(rule.fixedQty),
      }));
  }

  function handleGenerateBaselineBom(projectRef: string, tier: string, nodeCount: number, cloudSync: boolean) {
    const lines = evaluatePresalesRules(tier, nodeCount, cloudSync);
    if (lines.length === 0) {
      setPresalesStatus("No matching rules for that tier -- add some in Admin -> Pre-Sales Rules.");
      return;
    }
    setProjectSites((current) =>
      current.map((project) =>
        project.ref === projectRef
          ? {
              ...project,
              bom: [
                ...project.bom,
                ...lines.map((line) => ({
                  item: line.item,
                  qty: line.qty,
                  status: "Not started" as BomLine["status"],
                  requestSpeed: "Standard" as BomLine["requestSpeed"],
                  notes: "Auto-generated from pre-sales rules.",
                })),
              ],
            }
          : project,
      ),
    );
    setPresalesStatus(`Added ${lines.length} baseline line${lines.length === 1 ? "" : "s"} to the BOM.`);
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
    setInventoryMovements((current) => [movement, ...current]);

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
    setInventoryMovements((current) => [movement, ...current]);
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
      setInventoryMovements((current) => [...movements, ...current]);
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
    setInventoryMovements((current) => [movement, ...current]);
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
    setInventoryMovements((current) => [movement, ...current]);
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
    setInventoryMovements((current) => [movement, ...current]);
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
      setInventoryMovements((current) => [completionMovement as InventoryMovement, ...componentMovements, ...current]);
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
    setInventoryMovements((current) => [...undoMovements, ...current]);
    setBuildTransactions((current) => current.map((build) => (build.id === buildId ? { ...build, status: "undone", undoneAt } : build)));
    });
  }

  function updateBuildStage(buildId: string, stage: NonNullable<BuildTransaction["stage"]>) {
    setBuildTransactions((current) => current.map((build) => (build.id === buildId ? { ...build, stage } : build)));
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
    const next = purchaseRequestsRef.current.map((request) => (request.id === requestId ? { ...request, status } : request));
    purchaseRequestsRef.current = next;
    setPurchaseRequests(next);
    if (authSession) {
      await updatePurchaseRequestRemote(requestId, { status }, authSession.accessToken);
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
      setInventoryMovements((current) => [movement, ...current]);
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
      setAuthSession(session);
      setAuthPassword("");
      setAuthStatus(`Signed in as ${session.email}.`);
      setSyncStatus("loading");
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

  const allowedTabs: View[] = isAdmin
    ? ALL_TABS
    : ((ownAllowedViews && ownAllowedViews.length > 0 ? ownAllowedViews : DEFAULT_TABS_BY_ROLE[roleMode]) as View[]);
  const isManagerRole = authChecksReady && roleMode === "manager";
  const canReviewApprovals = isAdmin || isManagerRole;

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="top-nav-row">
          <div className="brand">
            <img className="brand-mark" src="/ergon-icon.png" alt="Ergon" />
            <div>
              <div className="brand-title">Ergon</div>
              <div className="brand-subtitle">Ops Command</div>
            </div>
          </div>
          <nav className="nav-list">
            {allowedTabs.includes("dashboard") && <NavButton icon={<LayoutDashboard size={16} />} label="Dashboard" active={view === "dashboard"} onClick={() => navigateToView("dashboard")} />}
            {allowedTabs.includes("purchasing") && <NavButton icon={<ShoppingCart size={16} />} label="Purchasing" active={view === "purchasing"} onClick={() => navigateToView("purchasing")} />}
            {allowedTabs.includes("inventory") && <NavButton icon={<Boxes size={16} />} label="Inventory" active={view === "inventory"} onClick={() => navigateToView("inventory")} />}
            {allowedTabs.includes("projects") && <NavButton icon={<ClipboardList size={16} />} label="Projects" active={view === "projects"} onClick={() => navigateToView("projects")} />}
            {allowedTabs.includes("sales") && <NavButton icon={<DollarSign size={16} />} label="Sales" active={view === "sales"} onClick={() => navigateToView("sales")} />}
            {allowedTabs.includes("tasks") && <NavButton icon={<ListChecks size={16} />} label="Tasks" active={view === "tasks"} onClick={() => navigateToView("tasks")} />}
            {allowedTabs.includes("reports") && <NavButton icon={<BarChart3 size={16} />} label="Reports" active={view === "reports"} onClick={() => navigateToView("reports")} />}
          </nav>
          <div className="top-nav-actions">
            <div className={`sync-status ${syncStatus}`}>
              <span>{syncStatus === "local" ? "Setup required" : syncStatus === "auth" ? "Sign in required" : syncStatus === "loading" ? "Cloud loading" : syncStatus === "saving" ? "Saving" : syncStatus === "synced" ? "Cloud synced" : "Sync issue"}</span>
            </div>
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
                      <button key={entry.id} className={`notification-row ${entry.isRead ? "" : "is-unread"}`} type="button" onClick={() => handleMarkNotificationRead(entry.id)}>
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
                  <label className="role-mode-select">Role view<select value={roleMode} onChange={(event) => setRoleMode(event.target.value as RoleMode)}><option value="warehouse">Warehouse</option><option value="purchasing">Purchasing</option><option value="pm">PM</option><option value="manager">Manager</option></select></label>
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
                        <button className="secondary-action mini-action" type="button" onClick={handleSignOut}>Sign out</button>
                      </>
                    ) : (
                      <>
                        <input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="Email" type="email" />
                        <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Password" type="password" />
                        <button className="secondary-action mini-action" type="button" onClick={handleSignIn} disabled={!isRemotePersistenceConfigured() || !authEmail || !authPassword}>Sign in</button>
                        <button className="secondary-action mini-action" type="button" onClick={handleSignUp} disabled={!isRemotePersistenceConfigured() || !authEmail || !authPassword}>Create user</button>
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
          <span>Search parts, POs, projects</span>
        </div>
      </header>

      <main className="main">
        <div className="page-heading">
          <h1>{pageTitle(view)}</h1>
          <p>Purchasing, inventory, project transfers, and reports for field packages.</p>
        </div>

        {view === "dashboard" && allowedTabs.includes("dashboard") && <Dashboard roleMode={roleMode} projectSites={projectSites} lowStock={lowStock} inventoryValue={inventoryValue} openPoValue={openPoValue} buildTransactions={buildTransactions} inventoryMovements={inventoryMovements} projectAllocations={projectAllocations} purchaseRequests={purchaseRequests} purchaseOrders={purchaseOrders} />}
        {view === "purchasing" && allowedTabs.includes("purchasing") && <Purchasing projectSites={projectSites} inventoryItems={inventoryItems} purchaseRequests={purchaseRequests} purchaseOrders={purchaseOrders} onCreatePurchaseOrder={handleCreatePurchaseOrder} onUpdatePurchaseOrderStatus={handleUpdatePurchaseOrderStatus} projectDocuments={projectDocuments} onCreateDocuments={handleCreateProjectDocuments} onUpdateDocumentStatus={handleUpdateProjectDocumentStatus} onDownloadDocument={handleDownloadDocument} lowStock={lowStock} buildTransactions={buildTransactions} onQueueReorderRequests={queueReorderRequests} onQueuePlannedBuildShortageRequests={queuePlannedBuildShortageRequests} onQueueManualPurchaseRequest={queueManualPurchaseRequest} onUpdatePurchaseRequest={updatePurchaseRequest} onUpdatePurchaseRequestStatus={updatePurchaseRequestStatus} onCancelPurchaseRequest={cancelPurchaseRequest} onReceivePurchaseRequest={receivePurchaseRequest} tasks={tasks} teamMembers={teamMembers} onCreateTask={handleCreateTask} onUpdateTask={handleUpdateTask} onDeleteTask={handleDeleteTask} onOpenTasksView={() => navigateToView("tasks")} />}
        {view === "inventory" && allowedTabs.includes("inventory") && <Inventory roleMode={roleMode} inventoryItems={inventoryItems} lowStock={lowStock} projectSites={projectSites} deviceRecipes={deviceRecipes} setDeviceRecipes={setDeviceRecipes} buildTransactions={buildTransactions} inventoryMovements={inventoryMovements} onAddItem={addInventoryItem} onUpdateItem={updateInventoryItem} onReceiveStock={receiveInventoryStock} onAdjustStock={adjustInventoryStock} onTransferToProject={transferInventoryToProject} onPlanBuild={planBuildTransaction} onBuildInventoryUnit={buildInventoryUnit} onUndoBuildTransaction={undoBuildTransaction} onUpdateBuildStage={updateBuildStage} onCancelPlannedBuild={cancelPlannedBuild} onQueueBuildShortageRequests={queueBuildShortageRequests} tasks={tasks} teamMembers={teamMembers} onCreateTask={handleCreateTask} onUpdateTask={handleUpdateTask} onDeleteTask={handleDeleteTask} onOpenTasksView={() => navigateToView("tasks")} />}
        {view === "projects" && allowedTabs.includes("projects") && <Projects projectSites={projectSites} setProjectSites={setProjectSites} inventoryItems={inventoryItems} projectDocuments={projectDocuments} onCreateDocuments={handleCreateProjectDocuments} onUpdateDocumentStatus={handleUpdateProjectDocumentStatus} onDownloadDocument={handleDownloadDocument} onInventoryPull={pullFromInventory} onQueueProjectBomPurchaseRequest={queueProjectBomPurchaseRequest} tasks={tasks} teamMembers={teamMembers} onCreateTask={handleCreateTask} onUpdateTask={handleUpdateTask} onDeleteTask={handleDeleteTask} onOpenTasksView={() => navigateToView("tasks")} scheduleTemplates={scheduleTemplates} scheduleStatus={scheduleStatus} onGenerateSchedule={handleGenerateSchedule} submittals={submittals} submittalStatus={submittalStatus} onLoadSubmittals={reloadSubmittals} onCreateSubmittal={handleCreateSubmittal} handoverSchema={handoverSchema} handovers={handovers} handoverStatus={handoverStatus} onLoadHandovers={reloadHandovers} onCreateHandover={handleCreateHandover} onSaveHandoverResponses={handleSaveHandoverResponses} onSubmitHandover={handleSubmitHandover} presalesRules={presalesRules} presalesStatus={presalesStatus} onGenerateBaselineBom={handleGenerateBaselineBom} />}
        {view === "sales" && allowedTabs.includes("sales") && (
          <SalesHome
            catalogItems={catalogItems}
            catalogStatus={catalogStatus}
            isConfigured={isRemotePersistenceConfigured()}
            canManageCatalog={isAdmin || roleMode === "manager"}
            onCreateCatalogItem={handleCreateCatalogItem}
            onUpdateCatalogItem={handleUpdateCatalogItem}
            onSetCatalogItemRetired={handleSetCatalogItemRetired}
            onBulkImportCatalogItems={handleBulkCreateCatalogItems}
            onRefreshCatalog={() => authSession && reloadCatalog(authSession.accessToken)}
            salesQuotes={salesQuotes}
            salesQuoteStatus={salesQuoteStatus}
            onCreateSalesQuote={handleCreateSalesQuote}
            onAddSalesQuoteLocation={handleAddSalesQuoteLocation}
            onUpdateSalesQuoteLocation={handleUpdateSalesQuoteLocation}
            onUploadSalesQuoteImage={handleUploadSalesQuoteImage}
            onDownloadSalesQuoteImage={handleDownloadSalesQuoteImage}
            projectSites={projectSites}
            tasks={tasks}
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
            projectSites={projectSites}
            teamMembers={teamMembers}
            status={taskStatusMessage}
            onCreate={handleCreateTask}
            onUpdate={handleUpdateTask}
            onDelete={handleDeleteTask}
            onRefresh={() => authSession && reloadTasks(authSession.accessToken)}
            inventoryItems={inventoryItems}
            taskHardwareDependencies={taskHardwareDependencies}
            onAddTaskDependency={handleAddTaskDependency}
            onDeleteTaskDependency={handleDeleteTaskDependency}
          />
        )}
        {view === "reports" && allowedTabs.includes("reports") && <Reports inventoryItems={inventoryItems} deviceRecipes={deviceRecipes} inventoryValue={inventoryValue} openPoValue={openPoValue} inventoryMovements={inventoryMovements} buildTransactions={buildTransactions} projectAllocations={projectAllocations} purchaseRequests={purchaseRequests} purchaseOrders={purchaseOrders} projectDocuments={projectDocuments} />}
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
            onGrantAdmin={handleGrantAdmin}
            onRevokeAdmin={handleRevokeAdmin}
            onSetAllowedViews={handleSetAllowedViews}
            onReviewApproval={handleReviewApproval}
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
            presalesRules={presalesRules}
            presalesStatus={presalesStatus}
            onAddPresalesRule={handleAddPresalesRule}
            onDeletePresalesRule={handleDeletePresalesRule}
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

function pageTitle(view: View) {
  const titles: Record<View, string> = {
    dashboard: "Dashboard",
    purchasing: "Purchasing",
    inventory: "Inventory",
    projects: "Projects",
    sales: "Sales",
    tasks: "Tasks",
    reports: "Reports",
    admin: "Admin",
  };
  return titles[view];
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
      title: "Purchasing Focus",
      label: "Today: shortages, held orders, and vendor cost changes",
      cards: [
        { label: "Open requests", value: String(activePurchaseRequests.length), note: activePurchaseRequests[0]?.itemName ?? "No queued purchase requests" },
        { label: "Reorder SKUs", value: String(lowStock.length), note: lowStock[0]?.name ?? "Inventory is above reorder points" },
        { label: "Captured spend", value: money(openPoValue), note: "From imported purchasing data" },
      ],
    },
    pm: {
      title: "PM Focus",
      label: "Today: project readiness and allocation movement",
      cards: [
        { label: "Active projects", value: String(projectSites.length), note: projectSites[0]?.name ?? "No projects yet" },
        { label: "Recent transfers", value: String(recentTransfers.length), note: recentTransfers[0]?.projectName ?? "No project transfers yet" },
        { label: "Purchasing projects", value: String(projectSites.filter((project) => project.status === "Purchasing").length), note: "Need BOM/order follow-through" },
      ],
    },
    manager: {
      title: "Manager Focus",
      label: "Today: inventory value, purchasing exposure, and manufacturing flow",
      cards: [
        { label: "Inventory value", value: money(inventoryValue), note: "Current stock value" },
        { label: "Request exposure", value: money(requestExposure), note: "Open purchase request estimate" },
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
        <PanelHeader title="Purchasing Attention" label="Orders needing follow-up" />
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
  teamMembers,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onOpenTasksView,
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
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">) => void;
  onUpdateTask: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => void;
  onDeleteTask: (id: string) => void;
  onOpenTasksView: () => void;
}) {
  const [selectedProject, setSelectedProject] = useState("Straud Medical");
  const [manualRequestPartRef, setManualRequestPartRef] = useState(() => inventoryItems.find((item) => !item.retired)?.ref ?? "");
  const [manualRequestQty, setManualRequestQty] = useState(1);
  const [manualRequestNotes, setManualRequestNotes] = useState("");
  const [manualRequestProject, setManualRequestProject] = useState("");
  const [manualRequestTrack, setManualRequestTrack] = useState<NonNullable<PurchaseRequest["procurementTrack"]>>("warehouse_stock");
  const [requestFilters, setRequestFilters] = useState({ text: "", status: "Open", reason: "All" });
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
        type: "Purchasing" as const,
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
        title="Purchasing Tasks"
        tasks={tasks.filter((task) => task.section === "purchasing")}
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
              <span>{Math.max(0, request.quantity - (request.receivedQuantity ?? 0))}<small>of {request.quantity}</small></span>
              <span>{request.reason}<small>{request.projectName ? `${request.projectName} - ${request.procurementTrack === "direct_to_project" ? "direct to project" : "warehouse stock"}` : request.sourceRef ?? request.preferredVendor ?? "No source"}</small></span>
              <span>{moneyExact(Math.max(0, request.quantity - (request.receivedQuantity ?? 0)) * request.estimatedUnitCost)}<small>{request.preferredVendor ?? "Vendor TBD"}</small></span>
              <span>
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
        <PanelHeader title="Upload Purchasing Document" label="Assign a PDF or receipt to a project before review" />
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
            type: "Purchasing" as const,
            storage: "Browser" as const,
          }))).map((doc) => (
            <div className="document-row" key={`${doc.id}-${doc.name}`}>
              <div>
                <strong>{doc.name}</strong>
                <span>{doc.project}{doc.size ? ` - ${formatBytes(doc.size)}` : " - imported sample"}{doc.storage ? ` - ${doc.storage}` : ""}</span>
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
  teamMembers,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onOpenTasksView,
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
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">) => void;
  onUpdateTask: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => void;
  onDeleteTask: (id: string) => void;
  onOpenTasksView: () => void;
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
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showBuildConfirm, setShowBuildConfirm] = useState(false);
  const [buildConfirmAck, setBuildConfirmAck] = useState(false);
  const [buildConfirmPlannedId, setBuildConfirmPlannedId] = useState<string | undefined>(undefined);
  const [workOrderBuildId, setWorkOrderBuildId] = useState<string | null>(null);
  const [inventoryTab, setInventoryTab] = useState<"parts" | "finished">("parts");
  const [filters, setFilters] = useState({ ref: "", part: "", category: "All", manufacturer: "", status: "All" });
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
  const transferItem = inventoryItems.find((part) => part.ref === transferDraft.partRef);
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
    purchasing: { title: "Purchasing workbench", body: "Watch reorder items, receive against POs, and keep vendor costs current." },
    pm: { title: "PM workbench", body: "Transfer stock to projects and review project allocation history from the ledger." },
    manager: { title: "Manager workbench", body: "Review inventory value, build readiness, shortages, and recent transactions." },
  };
  const rolePermissions: Record<RoleMode, string[]> = {
    warehouse: ["Receive", "Adjust", "Transfer", "Scan"],
    purchasing: ["Requests", "Receive PO", "Costs", "Vendors"],
    pm: ["Projects", "BOM", "Transfers", "Docs"],
    manager: ["Reports", "Builds", "Ledger", "Approvals"],
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
      })),
    );
  }

  function toggleItemRetired() {
    setItemDraft((current) => ({ ...current, retired: !current.retired }));
  }

  function openTransferModal(part: Part) {
    setTransferDraft({
      partRef: part.ref,
      projectName: projectSites[0]?.name ?? "",
      qty: 1,
      notes: "",
    });
    setShowTransferModal(true);
  }

  function openReceiveModal(part?: Part) {
    const target = part ?? inventoryItems.find((item) => !item.retired) ?? inventoryItems[0];
    if (!target) {
      return;
    }
    setReceiveDraft({
      partRef: target.ref,
      qty: 1,
      unitCost: target.cost,
      poNumber: "",
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
    setShowTransferModal(false);
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

  return (
    <div className="content-grid">
      <TaskMiniPanel
        title="Inventory Tasks"
        tasks={tasks.filter((task) => task.section === "inventory" || task.section === "warehouse")}
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
            <p>{inventoryTab === "finished" ? "Finished manufactured equipment ready for projects" : "Purchasing parts, components, and field hardware"}</p>
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
          <table className="inventory-table">
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
              {filteredInventoryItems.map((part) => (
                <tr key={part.ref}>
                  <td>
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
                  <td>
                    <div className="table-actions">
                      <button className="table-action secondary-table-action" type="button" onClick={() => openReceiveModal(part)} disabled={part.retired}>Receive</button>
                      <button className="table-action secondary-table-action" type="button" onClick={() => openAdjustModal(part)} disabled={part.retired}>Adjust</button>
                      <button className="table-action secondary-table-action" type="button" onClick={() => openEditItemModal(part)}>Edit</button>
                      <button className="table-action" type="button" onClick={() => openTransferModal(part)} disabled={part.retired}>Transfer</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        {buildHasShortage && <div className="source-file"><ShoppingCart size={16} /><span>Some build parts are short. Those lines are flagged above so Purchasing knows what needs to be ordered before this build can be completed.</span></div>}
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
              <span><strong>{movement.type.replace("_", " ")}</strong><small>{new Date(movement.createdAt).toLocaleString()}</small></span>
              <span>{movement.sku}<small>{movement.itemName}</small></span>
              <span>{movement.quantity}</span>
              <span>{movement.quantityBefore} / {movement.quantityAfter}</span>
              <span>{movement.projectName ?? movement.buildNumber ?? movement.poNumber ?? movement.source}<small>{movement.notes}</small></span>
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
      {showTransferModal && transferItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="inventory-transfer-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="inventory-transfer-modal-title">Transfer Inventory To Project</h2>
                <p>Move stock out of inventory and add it to the selected project BOM.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowTransferModal(false)} aria-label="Close transfer modal">x</button>
            </div>
            <div className="bom-modal-grid">
              <label className="span-2">Item<select value={transferDraft.partRef} onChange={(event) => setTransferDraft((current) => ({ ...current, partRef: event.target.value }))}>{inventoryItems.map((part) => <option key={part.ref} value={part.ref}>{part.ref} - {part.name} ({part.stock} available)</option>)}</select></label>
              <label>Project<select value={transferDraft.projectName} onChange={(event) => setTransferDraft((current) => ({ ...current, projectName: event.target.value }))}>{projectSites.map((project) => <option key={project.name} value={project.name}>{project.ref} - {project.name}</option>)}</select></label>
              <label>Quantity<input type="number" min="1" max={transferItem.stock} value={transferDraft.qty} onChange={(event) => setTransferDraft((current) => ({ ...current, qty: Number(event.target.value) }))} /></label>
              <label className="span-2">Notes<textarea value={transferDraft.notes} onChange={(event) => setTransferDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Install phase, location, reason, or approval note." /></label>
            </div>
            <div className="source-file"><Boxes size={16} /><span>{transferItem.stock} available. Transfer will leave {Math.max(0, transferItem.stock - Math.max(1, Math.round(Number(transferDraft.qty) || 1)))} in inventory.</span></div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowTransferModal(false)}>Cancel</button>
              <button className="primary-action" type="button" onClick={saveTransfer}>Transfer To Project</button>
            </div>
          </section>
        </div>
      )}
      {showReceiveModal && receiveItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="inventory-receive-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="inventory-receive-modal-title">Receive Stock</h2>
                <p>Add arrived parts to inventory and record the PO or vendor reference.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowReceiveModal(false)} aria-label="Close receive modal">x</button>
            </div>
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
      )}
      {showAdjustModal && adjustItem && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="inventory-adjust-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="inventory-adjust-modal-title">Adjust Stock Count</h2>
                <p>Use this for cycle counts, damaged items, corrections, or retire cleanup.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowAdjustModal(false)} aria-label="Close adjust modal">x</button>
            </div>
            <div className="bom-modal-grid">
              <label className="span-2">Item<select value={adjustDraft.partRef} onChange={(event) => {
                const next = inventoryItems.find((part) => part.ref === event.target.value);
                setAdjustDraft((current) => ({ ...current, partRef: event.target.value, nextQty: next?.stock ?? current.nextQty }));
              }}>{inventoryItems.filter((part) => !part.retired).map((part) => <option key={part.ref} value={part.ref}>{part.ref} - {part.name} ({part.stock} on hand)</option>)}</select></label>
              <label>New count<input type="number" min="0" value={adjustDraft.nextQty} onChange={(event) => setAdjustDraft((current) => ({ ...current, nextQty: Number(event.target.value) }))} /></label>
              <label className="span-2">Reason / notes<textarea value={adjustDraft.notes} onChange={(event) => setAdjustDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Cycle count, damaged, missing, found, returned, or correction reason." /></label>
            </div>
            <div className="source-file"><ClipboardList size={16} /><span>{adjustItem.ref} will move from {adjustItem.stock} to {Math.max(0, Math.round(Number(adjustDraft.nextQty) || 0))}.</span></div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowAdjustModal(false)}>Cancel</button>
              <button className="primary-action" type="button" onClick={saveAdjust}>Save Adjustment</button>
            </div>
          </section>
        </div>
      )}
    </div>
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
  presalesRules,
  presalesStatus,
  onGenerateBaselineBom,
}: {
  projectSites: ProjectSite[];
  setProjectSites: Dispatch<SetStateAction<ProjectSite[]>>;
  inventoryItems: Part[];
  projectDocuments: UploadedDoc[];
  onCreateDocuments: (entries: Array<{ doc: Omit<UploadedDoc, "id">; file?: File }>) => void;
  onUpdateDocumentStatus: (id: UploadedDoc["id"], status: UploadedDoc["status"]) => void;
  onDownloadDocument: (doc: UploadedDoc) => void;
  onInventoryPull: (itemName: string, qty: number, projectName?: string, notes?: string) => void;
  onQueueProjectBomPurchaseRequest: (partName: string, quantity: number, projectName: string, projectRef: string, requestSpeed: BomLine["requestSpeed"], notes: string, procurementTrack: PurchaseRequest["procurementTrack"]) => Promise<boolean>;
  tasks: EOTask[];
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">) => void;
  onUpdateTask: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => void;
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
  presalesRules: PresalesHardwareRule[];
  presalesStatus: string;
  onGenerateBaselineBom: (projectRef: string, tier: string, nodeCount: number, cloudSync: boolean) => void;
}) {
  const initialProjectSlug = window.location.hash.startsWith("#projects/") ? window.location.hash.split("/")[1] : "";
  const initialProject = projectSites.find((project) => projectSlug(project.name) === initialProjectSlug);
  const [selectedProjectName, setSelectedProjectName] = useState(initialProject?.name ?? projects[0].name);
  const [projectMode, setProjectMode] = useState<"list" | "detail">(initialProject ? "detail" : "list");
  const [actionStatus, setActionStatus] = useState("Select a project, add a blank project, or build one from a sales quote.");
  const [isExtractingQuote, setIsExtractingQuote] = useState(false);
  const [scheduleTemplateChoice, setScheduleTemplateChoice] = useState("");
  const [submittalClientName, setSubmittalClientName] = useState("");
  const [submittalClientEmail, setSubmittalClientEmail] = useState("");
  const [copiedSubmittalId, setCopiedSubmittalId] = useState("");
  const [presalesTier, setPresalesTier] = useState("");
  const [presalesNodeCount, setPresalesNodeCount] = useState(1);
  const [presalesCloudSync, setPresalesCloudSync] = useState(false);
  const [bomImportRows, setBomImportRows] = useState<Array<{ item: string; qty: number }>>([]);
  const [bomImportStatus, setBomImportStatus] = useState("");
  const [showBomModal, setShowBomModal] = useState(false);
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
  const totalProjectValue = projectSites.reduce((sum, project) => sum + project.allocated, 0);
  const purchasingProjects = projectSites.filter((project) => project.status === "Purchasing").length;
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

  function projectCompletion(project: ProjectSite) {
    if (project.bom.length === 0) {
      return 0;
    }

    const done = project.bom.filter((line) => line.status === "Completed" || line.status === "Delivered to Office" || line.status === "Delivered to Client" || line.status === "From Inventory").length;
    return Math.round((done / project.bom.length) * 100);
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
      siteNotes: "Draft project record. Add garage/lot details, install requirements, and BOM lines before sending to Purchasing.",
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

  function updateSowField<K extends keyof ScopeOfWork>(field: K, value: ScopeOfWork[K]) {
    updateSelectedProject((project) => ({ ...project, sow: { ...project.sow, [field]: value } }));
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
      action: line.status === "From Inventory" ? "pull" : "order",
      requestSpeed: line.requestSpeed,
      notes: line.notes ?? "",
    });
    setShowBomModal(true);
  }

  function closeBomModal() {
    setShowBomModal(false);
    setEditingBomIndex(null);
  }

  async function addBomLine() {
    const item = bomDraft.item.trim();
    const qty = Math.max(1, Math.round(Number(bomDraft.qty) || 1));
    if (!item) {
      setActionStatus("Add a material item before saving the BOM line.");
      return;
    }

    const pullingFromInventory = bomDraft.action === "pull" && selectedInventoryItem && selectedInventoryItem.stock >= qty;
    const directToProject = bomDraft.action === "direct";
    const line: BomLine = {
      item,
      qty,
      status: pullingFromInventory ? "From Inventory" : "Need Quote",
      requestSpeed: bomDraft.requestSpeed,
      notes: bomDraft.notes || (pullingFromInventory ? `Pulled from inventory. ${selectedInventoryItem.stock - qty} remaining.` : directToProject ? "Requested as direct-to-project purchase." : "Requested for Purchasing to order into warehouse stock."),
    };

    updateSelectedProject((project) => ({
      ...project,
      bom:
        editingBomIndex === null
          ? [...project.bom, line]
          : project.bom.map((existingLine, index) => (index === editingBomIndex ? line : existingLine)),
    }));

    if (editingBomIndex !== null) {
      setActionStatus(`${item} was updated in ${selectedProject.ref}.`);
    } else if (pullingFromInventory) {
      onInventoryPull(item, qty, selectedProject.name, bomDraft.notes || `Pulled from inventory for ${selectedProject.ref} BOM.`);
      setActionStatus(`${qty} ${item} added to ${selectedProject.ref} and pulled from inventory.`);
    } else if (bomDraft.action === "pull" && selectedInventoryItem) {
      const queued = await onQueueProjectBomPurchaseRequest(item, qty, selectedProject.name, selectedProject.ref, bomDraft.requestSpeed, bomDraft.notes, "warehouse_stock");
      setActionStatus(queued ? `${item} was added as Need Quote because only ${selectedInventoryItem.stock} are available in inventory. Purchasing request created.` : `${item} was added as Need Quote, but no SKU match was found for Purchasing.`);
    } else {
      const queued = await onQueueProjectBomPurchaseRequest(item, qty, selectedProject.name, selectedProject.ref, bomDraft.requestSpeed, bomDraft.notes, directToProject ? "direct_to_project" : "warehouse_stock");
      setActionStatus(queued ? `${qty} ${item} added to ${selectedProject.ref} as a ${directToProject ? "direct-to-project" : "warehouse stock"} purchasing request.` : `${qty} ${item} added to ${selectedProject.ref}, but Purchasing request was not created because it is not matched to a SKU.`);
    }

    setBomDraft({ item: parts[0].name, qty: 1, action: "pull", requestSpeed: "Standard", notes: "" });
    closeBomModal();
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
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
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
    setActionStatus(`${files.length} document${files.length === 1 ? "" : "s"} attached to ${selectedProject.ref}.`);
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
        <TaskMiniPanel
          title="Projects Tasks"
          tasks={tasks.filter((task) => task.section === "projects" && !task.projectRef)}
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

        <section className="panel wide">
          <div className="action-header">
            <PanelHeader title="Projects" label="Project list, completion, and PM handoff status" />
          </div>
        </section>

        <section className="metric-grid">
          <Metric icon={<ClipboardList size={20} />} label="Projects" value={String(projectSites.length)} />
          <Metric icon={<DollarSign size={20} />} label="Allocated Value" value={money(totalProjectValue)} />
          <Metric icon={<ShoppingCart size={20} />} label="In Purchasing" value={String(purchasingProjects)} />
          <Metric icon={<FileText size={20} />} label="Draft / Planning" value={String(draftProjects)} />
        </section>

        <section className="panel full">
          <div className="action-header">
            <PanelHeader title="Project List" label="Open a project to edit site info, SOW, and BOM" />
            <div className="action-row">
              <button className="primary-action" type="button" onClick={addDraftProject}><Plus size={17} /> Add New Project</button>
              <RequestTaskButton section="projects" teamMembers={teamMembers} projectSites={projectSites} onCreate={onCreateTask} />
            </div>
          </div>
          <table>
            <thead>
              <tr><th>Ref</th><th>Project</th><th>Client</th><th>Status</th><th>Completion</th><th>Open BOM</th><th>Target</th><th>Allocated</th><th></th></tr>
            </thead>
            <tbody>
              {projectSites.map((project) => {
                const completion = projectCompletion(project);
                const openLines = project.bom.filter((line) => line.status === "Need Quote" || line.status === "Not started").length;
                return (
                  <tr key={project.name}>
                    <td><strong>{project.ref}</strong></td>
                    <td><strong>{project.name}</strong><small>{project.type} - {project.package}</small></td>
                    <td>{project.client}</td>
                    <td><span className={`status ${project.status === "Purchasing" ? "warn" : project.status === "Install Ready" ? "ok" : ""}`}>{project.status}</span></td>
                    <td>
                      <div className="progress-cell"><span>{completion}%</span><i><b style={{ width: `${completion}%` }} /></i></div>
                    </td>
                    <td>{openLines}</td>
                    <td>{project.due}</td>
                    <td>{money(project.allocated)}</td>
                    <td><button className="table-action" type="button" onClick={() => openProject(project.name)}>Open</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
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
        <section className="panel compact-card">
          <PanelHeader title="Build Sales BOM and Scope" label="One-time setup: upload a sales quote PDF" />
          <label className={`sales-dropzone compact-row ${isExtractingQuote ? "is-working" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleSalesQuoteDrop}>
            <Upload size={15} />
            <strong>{isExtractingQuote ? "Reading sales quote..." : "Drag or choose sales quote PDF"}</strong>
            <input type="file" accept=".pdf" onChange={handleSalesQuoteSelect} disabled={isExtractingQuote} />
          </label>
          {selectedProject.salesQuoteFile && <div className="source-file"><FileText size={16} /><span>{selectedProject.salesQuoteFile}</span></div>}
        </section>

        <section className="panel compact-card">
          <div className="panel-title-row">
            <div>
              <h2>Project Documents</h2>
              <p>Backups and reference files.</p>
            </div>
            <label className="secondary-action mini-action project-doc-upload">
              <Upload size={15} /> Upload
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx,.csv" multiple onChange={handleProjectDocumentSelect} />
            </label>
          </div>
          <div className="project-doc-list">
            {selectedProjectDocuments.map((doc) => (
              <div className="document-row" key={`${doc.id}-${doc.name}`}>
                <div>
                  <strong>{doc.name}</strong>
                  <span>{doc.type ?? "Project"} - {doc.size ? formatBytes(doc.size) : "linked sample"} - {doc.storage ?? "Browser"}</span>
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

        <section className="panel compact-card project-progress-card">
          <PanelHeader title="Project Progress" label="Completion and key points" />
          <div className="project-progress-body">
            <div className="progress-ring" style={{ "--pct": projectCompletion(selectedProject) } as React.CSSProperties}>
              <span>{projectCompletion(selectedProject)}%</span>
            </div>
            <div className="progress-points">
              <div><span>Status</span><strong className={`status ${selectedProject.status === "Purchasing" ? "warn" : selectedProject.status === "Install Ready" ? "ok" : ""}`}>{selectedProject.status}</strong></div>
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

      <TaskMiniPanel
        title="Project Tasks"
        tasks={tasks.filter((task) => task.projectRef === selectedProject.ref)}
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
                  className="secondary-action mini-action"
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

      <section className="panel full">
        <PanelHeader title="Pre-Sales Quick Estimate" label="Derive a baseline hardware BOM from tier, node count, and connectivity" />
        {presalesStatus && <small className="muted">{presalesStatus}</small>}
        <div className="submittal-create-row">
          <select value={presalesTier} onChange={(event) => setPresalesTier(event.target.value)}>
            <option value="">Select tier...</option>
            {Array.from(new Set(presalesRules.map((rule) => rule.tier))).map((tier) => (
              <option key={tier} value={tier}>{tier}</option>
            ))}
          </select>
          <input type="number" min={1} value={presalesNodeCount} onChange={(event) => setPresalesNodeCount(Number(event.target.value))} placeholder="Node count" />
          <label className="checkbox-inline-field">
            <input type="checkbox" checked={presalesCloudSync} onChange={(event) => setPresalesCloudSync(event.target.checked)} />
            Cloud sync required
          </label>
          <button
            className="primary-action mini-action"
            type="button"
            disabled={!presalesTier}
            onClick={() => onGenerateBaselineBom(selectedProject.ref, presalesTier, presalesNodeCount, presalesCloudSync)}
          >
            Generate Baseline BOM
          </button>
        </div>
      </section>

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
                    {field.label}{field.isRequired ? " *" : ""}
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

      <section className="panel full">
        <div className="panel-title-row">
          <div>
            <h2>Project Details</h2>
            <p>Editable site intake for this parking garage or lot</p>
          </div>
        </div>
        <div className="form-grid">
          <label>Project name<input value={selectedProject.name} onChange={(event) => updateProjectField("name", event.target.value)} /></label>
          <label>Client / property<input value={selectedProject.client} onChange={(event) => updateProjectField("client", event.target.value)} /></label>
          <label>Site type<select value={selectedProject.type} onChange={(event) => updateProjectField("type", event.target.value as ProjectSite["type"])}><option>Parking Garage</option><option>Surface Lot</option><option>Campus Parking</option><option>Mixed Parking</option></select></label>
          <label>Project owner<input value={selectedProject.owner} onChange={(event) => updateProjectField("owner", event.target.value)} /></label>
          <label className="span-2">Client location / shipping address<input value={selectedProject.address} onChange={(event) => updateProjectField("address", event.target.value)} /></label>
          <label>Status<select value={selectedProject.status} onChange={(event) => updateProjectField("status", event.target.value as ProjectSite["status"])}><option>Draft</option><option>Planning</option><option>Purchasing</option><option>Staging</option><option>Install Ready</option></select></label>
          <label>Target date<input value={selectedProject.due} onChange={(event) => updateProjectField("due", event.target.value)} /></label>
          <label className="span-2">Solution / package<input value={selectedProject.package} onChange={(event) => updateProjectField("package", event.target.value)} /></label>
          <label className="span-2">Site notes<textarea value={selectedProject.siteNotes} onChange={(event) => updateProjectField("siteNotes", event.target.value)} /></label>
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Site Information" label="Client, location, and install context" />
        <div className="site-info-list">
          <div><Building2 size={17} /><span>Client</span><strong>{selectedProject.client}</strong></div>
          <div><MapPin size={17} /><span>Location</span><strong>{selectedProject.address}</strong></div>
          <div><User size={17} /><span>Owner</span><strong>{selectedProject.owner}</strong></div>
          <div><CalendarDays size={17} /><span>Target</span><strong>{selectedProject.due}</strong></div>
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Project Snapshot" label="PM request summary" />
        <div className="snapshot-grid">
          <div><span>Cameras</span><strong>{selectedProject.cameras}</strong></div>
          <div><span>BOM Units</span><strong>{bomUnits}</strong></div>
          <div><span>Open BOM Lines</span><strong>{openBomLines}</strong></div>
          <div><span>Allocated</span><strong>{money(selectedProject.allocated)}</strong></div>
        </div>
      </section>

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

      <section className="panel full">
        <div className="panel-title-row">
          <div>
            <h2>BOM - Bill of Material</h2>
            <p>Add, edit, pull from inventory, or request Purchasing orders.</p>
          </div>
          <div className="report-filter-row">
            <label className="secondary-action mini-action project-doc-upload">
              <Upload size={15} /> Import Spreadsheet
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleBomFileSelect} />
            </label>
            <button className="primary-action" type="button" onClick={openAddBomModal}><Plus size={17} /> Add Material</button>
          </div>
        </div>
        {bomImportStatus && <small className="muted">{bomImportStatus}</small>}
        {bomImportRows.length > 0 && (
          <div className="bom-import-preview">
            <table>
              <thead><tr><th>Item</th><th>Qty</th></tr></thead>
              <tbody>
                {bomImportRows.map((row, index) => <tr key={index}><td>{row.item}</td><td>{row.qty}</td></tr>)}
              </tbody>
            </table>
            <div className="report-filter-row">
              <button className="primary-action mini-action" type="button" onClick={commitBomImport}>Commit {bomImportRows.length} Line(s) to BOM</button>
              <button className="secondary-action mini-action" type="button" onClick={() => { setBomImportRows([]); setBomImportStatus(""); }}>Discard</button>
            </div>
          </div>
        )}
        <table>
          <thead>
            <tr><th>Hardware</th><th>Qty</th><th>Status</th><th>Request Speed</th><th>PO</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {selectedProject.bom.map((line, index) => (
              <tr key={`${selectedProject.name}-${line.item}-${index}`}>
                <td><strong>{line.item}</strong></td>
                <td>{line.qty}</td>
                <td><span className={`status ${line.status === "Need Quote" || line.status === "Not started" ? "warn" : line.status.includes("Delivered") || line.status === "Completed" || line.status === "From Inventory" ? "ok" : ""}`}>{line.status}</span></td>
                <td>{line.requestSpeed}</td>
                <td>{line.po ?? "TBD"}</td>
                <td>{line.notes ?? "Ready for PM details"}</td>
                <td><button className="table-action secondary-table-action" type="button" onClick={() => openEditBomModal(line, index)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showBomModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="bom-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="bom-modal-title">{editingBomIndex === null ? "Add BOM Material" : "Edit BOM Material"}</h2>
                <p>{editingBomIndex === null ? "Add a project material line, then pull from stock or request an order." : "Update this material line. Inventory pulls only happen when adding a new line."}</p>
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
                  <span><strong>Request warehouse stock order</strong><small>Purchasing receives this into warehouse inventory</small></span>
                </label>
                <label>
                  <input type="radio" name="bom-action" checked={bomDraft.action === "direct"} onChange={() => updateBomDraft("action", "direct")} />
                  <span><strong>Request direct-to-project order</strong><small>Purchasing receives this against the project, not warehouse stock</small></span>
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

      <section className="panel full">
        <PanelHeader title="Project Transfers" label="Inventory allocated by project" />
        <div className="project-grid">
          {projectSites.map((project) => (
            <article className="project-card" key={project.name}>
              <div className="project-top">
                <h3>{project.name}</h3>
                <span className="status">{project.status}</span>
              </div>
              <p>{project.package}</p>
              <div className="project-details">
                <span><CalendarDays size={15} /> {project.due}</span>
                <span><Boxes size={15} /> {project.cameras} cameras</span>
                <span><DollarSign size={15} /> {money(project.allocated)}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
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
}) {
  const [reportTab, setReportTab] = useState<"purchasing" | "inventory" | "manufacturing" | "projects" | "documents">("purchasing");
  const [reportFilters, setReportFilters] = useState({ search: "", project: "All", vendor: "All", from: "", to: "" });
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
            <p>Purchasing, inventory, manufacturing, and project movement views.</p>
          </div>
          <button className="secondary-action" type="button" onClick={exportActiveReport}><FileText size={16} /> Export CSV</button>
        </div>
        <div className="segmented-tabs report-tabs">
          <button className={reportTab === "purchasing" ? "active" : ""} type="button" onClick={() => setReportTab("purchasing")}>Purchasing</button>
          <button className={reportTab === "inventory" ? "active" : ""} type="button" onClick={() => setReportTab("inventory")}>Inventory</button>
          <button className={reportTab === "manufacturing" ? "active" : ""} type="button" onClick={() => setReportTab("manufacturing")}>Manufacturing</button>
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
                <span>{Math.max(0, request.quantity - (request.receivedQuantity ?? 0))}<small>of {request.quantity}</small></span>
                <span>{request.reason}<small>{request.sourceRef ?? request.preferredVendor ?? "No source"}</small></span>
                <span className="status warn">{request.status}</span>
                <span>{moneyExact(Math.max(0, request.quantity - (request.receivedQuantity ?? 0)) * request.estimatedUnitCost)}<small>{request.preferredVendor ?? "Vendor TBD"}</small></span>
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
                <span>{part.stock}</span>
                <span>{part.reorderPoint}</span>
                <span className="status warn">Reorder</span>
                <span>{part.manufacturer}<small>{part.category}</small></span>
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
                <span>{moneyExact(trend.latest.unitCost)}</span>
                <span>{trend.previous ? moneyExact(trend.previous.unitCost) : "No prior"}</span>
                <span className={trend.change > 0 ? "cost-up" : trend.change < 0 ? "cost-down" : ""}>{trend.change === 0 ? "Flat" : `${trend.change > 0 ? "+" : ""}${moneyExact(trend.change)} (${trend.percent.toFixed(1)}%)`}</span>
                <span>{trend.latest.vendor}<small>{trend.latest.date}</small></span>
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
          <p className="muted">Current inventory value plus recent order PDFs now captured in Purchasing.</p>
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
              <span>{build.quantityBuilt}</span>
              <span>{build.stage ?? "complete"}</span>
              <span>{build.status}</span>
              <span>{new Date(build.createdAt).toLocaleString()}</span>
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
              <span>{row.sku}<small>{row.itemName}</small></span>
              <span>{row.required}</span>
              <span>{row.available}</span>
              <span className="status warn">{row.shortage}</span>
            </div>
          ))}
          {plannedBuildShortages.length === 0 && <div className="empty-compact-state">No planned build shortages currently found.</div>}
        </div>
      </section>}
      {reportTab === "projects" && <section className="panel wide">
        <PanelHeader title="Project Allocation History" label="Every SKU movement tied to a project" />
        <div className="report-table compact-report-table">
          <div className="report-table-head"><span>Project</span><span>SKU</span><span>Qty</span><span>Action</span><span>Notes</span></div>
          {filteredProjectAllocations.slice(0, 14).map((allocation) => (
            <div className="report-table-row" key={allocation.id}>
              <span><strong>{allocation.projectName}</strong><small>{allocation.projectRef ?? "No PRJ"}</small></span>
              <span>{allocation.sku}<small>{allocation.itemName}</small></span>
              <span>{allocation.quantity}</span>
              <span>{allocation.action}</span>
              <span>{allocation.notes}<small>{new Date(allocation.createdAt).toLocaleString()}</small></span>
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
          <div className="report-table-head"><span>Project</span><span>Document</span><span>Type</span><span>Status</span><span>Storage</span></div>
          {filteredProjectDocuments.slice(0, 16).map((doc) => (
            <div className="report-table-row" key={`${doc.id}-${doc.name}`}>
              <span>{doc.project}</span>
              <span><strong>{doc.name}</strong><small>{doc.size ? formatBytes(doc.size) : "No file size saved"}</small></span>
              <span>{doc.type ?? "Project"}</span>
              <span>{doc.status}</span>
              <span>{doc.storage ?? "Browser"}<small>{doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString() : ""}</small></span>
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
  { value: "purchasing", label: "Purchasing" },
  { value: "pm", label: "PM" },
  { value: "manager", label: "Manager" },
];

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
        <button className="primary-action mini-action" type="button" onClick={() => onApprove(roleKey, expiresOn ? new Date(expiresOn).toISOString() : null)}>Approve</button>
        <button className="secondary-action mini-action" type="button" onClick={onDeny}>Deny</button>
      </td>
    </tr>
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
  onGrantAdmin,
  onRevokeAdmin,
  onSetAllowedViews,
  onReviewApproval,
  onRefresh,
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
  presalesRules,
  presalesStatus,
  onAddPresalesRule,
  onDeletePresalesRule,
}: {
  currentUserId: string;
  isAdmin: boolean;
  isManagerRole: boolean;
  knownUsers: KnownUser[];
  userRoleMap: Record<string, string>;
  adminIds: string[];
  allowedViewsMap: Record<string, string[] | null>;
  approvalStatuses: UserStatus[];
  status: string;
  approvalStatusMessage: string;
  onSetRole: (userId: string, roleKey: string) => void;
  onGrantAdmin: (userId: string) => void;
  onRevokeAdmin: (userId: string) => void;
  onSetAllowedViews: (userId: string, views: string[] | null) => void;
  onReviewApproval: (userId: string, status: ApprovalStatus, expiresAt: string | null) => void;
  onRefresh: () => void;
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
  presalesRules: PresalesHardwareRule[];
  presalesStatus: string;
  onAddPresalesRule: (rule: Omit<PresalesHardwareRule, "id">) => void;
  onDeletePresalesRule: (id: string) => void;
}) {
  const [rosterDraft, setRosterDraft] = useState({ fullName: "", email: "", roleTitle: "" });
  const [timeDraft, setTimeDraft] = useState({ category: "", hoursPerUnit: 0, notes: "" });
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [phaseDrafts, setPhaseDrafts] = useState<Record<string, { phaseName: string; durationMode: "fixed_hours" | "per_bom_unit"; fixedHours: number; bomCategoryFilter: string; defaultRole: string }>>({});
  const [formFieldDraft, setFormFieldDraft] = useState({ section: "site_requirements", label: "", fieldType: "text" as FormSchemaField["fieldType"], placeholder: "", isRequired: false, optionsRaw: "" });
  const [presalesRuleDraft, setPresalesRuleDraft] = useState({ tier: "", baseItemName: "", quantityMode: "fixed" as PresalesHardwareRule["quantityMode"], fixedQty: 1, perNodeDivisor: 16, requiresCloudSync: "any" as "any" | "yes" | "no" });

  function phaseDraftFor(templateId: string) {
    return phaseDrafts[templateId] ?? { phaseName: "", durationMode: "fixed_hours" as const, fixedHours: 4, bomCategoryFilter: "", defaultRole: "" };
  }

  function submitRosterDraft() {
    if (!rosterDraft.fullName.trim()) {
      return;
    }
    onAddTeamMember({ fullName: rosterDraft.fullName.trim(), email: rosterDraft.email.trim(), roleTitle: rosterDraft.roleTitle.trim(), isActive: true });
    setRosterDraft({ fullName: "", email: "", roleTitle: "" });
  }

  const usersByid = new Map(knownUsers.map((user) => [user.userId, user]));
  const approvalByUserId = new Map(approvalStatuses.map((entry) => [entry.userId, entry]));
  const pendingUsers = approvalStatuses
    .filter((entry) => entry.approvalStatus === "pending" && !adminIds.includes(entry.userId))
    .map((entry) => usersByid.get(entry.userId))
    .filter((user): user is KnownUser => Boolean(user));

  return (
    <div className="content-grid">
      <section className="panel wide">
        <PanelHeader title="Pending Approvals" label="New sign-ins wait here until a Manager or Admin lets them in" />
        <div className="report-filter-row">
          <button className="secondary-action mini-action" type="button" onClick={onRefresh}>Refresh</button>
          {approvalStatusMessage && <span className="muted">{approvalStatusMessage}</span>}
        </div>
        <table>
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
          <PanelHeader title="Team Roster" label="People who can be assigned tasks, whether or not they've ever logged in" />
          <div className="report-filter-row">
            {teamMemberStatus && <span className="muted">{teamMemberStatus}</span>}
          </div>
          <div className="roster-add-row">
            <input value={rosterDraft.fullName} onChange={(event) => setRosterDraft((current) => ({ ...current, fullName: event.target.value }))} placeholder="Full name" />
            <input value={rosterDraft.email} onChange={(event) => setRosterDraft((current) => ({ ...current, email: event.target.value }))} placeholder="Email (optional)" />
            <input value={rosterDraft.roleTitle} onChange={(event) => setRosterDraft((current) => ({ ...current, roleTitle: event.target.value }))} placeholder="Role / title (optional)" />
            <button className="primary-action mini-action" type="button" onClick={submitRosterDraft} disabled={!rosterDraft.fullName.trim()}><Plus size={14} /> Add person</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role / title</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((member) => (
                <tr key={member.id}>
                  <td>{member.fullName}</td>
                  <td>{member.email || "-"}</td>
                  <td>{member.roleTitle || "-"}</td>
                  <td>{member.isActive ? "Active" : "Inactive"}</td>
                  <td>
                    <button className="secondary-action mini-action" type="button" onClick={() => onUpdateTeamMember(member.id, { isActive: !member.isActive })}>
                      {member.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
              {teamMembers.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-compact-state">No one on the roster yet. Add teammates above so tasks can be assigned to them.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel wide">
          <PanelHeader title="Notification Rules" label="Which channel(s) fire for each event -- programmable, no code change needed" />
          <table>
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
                  <td><input type="checkbox" checked={rule.channels.includes("in_app")} onChange={(event) => onUpdateNotificationRule(rule.id, { channels: event.target.checked ? [...rule.channels, "in_app"] : rule.channels.filter((c) => c !== "in_app") })} /></td>
                  <td><input type="checkbox" checked={rule.channels.includes("email")} disabled title="Needs an email provider secret -- not configured yet" onChange={(event) => onUpdateNotificationRule(rule.id, { channels: event.target.checked ? [...rule.channels, "email"] : rule.channels.filter((c) => c !== "email") })} /></td>
                  <td><input type="checkbox" checked={rule.channels.includes("slack")} disabled title="Needs a Slack/Teams webhook -- not configured yet" onChange={(event) => onUpdateNotificationRule(rule.id, { channels: event.target.checked ? [...rule.channels, "slack"] : rule.channels.filter((c) => c !== "slack") })} /></td>
                  <td><input type="checkbox" checked={rule.isActive} onChange={(event) => onUpdateNotificationRule(rule.id, { isActive: event.target.checked })} /></td>
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
          <table>
            <thead><tr><th>Category</th><th>Hours / unit</th><th>Notes</th></tr></thead>
            <tbody>
              {standardInstallTimes.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.category}</td>
                  <td>{entry.hoursPerUnit}</td>
                  <td>{entry.notes || "-"}</td>
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
                <table>
                  <thead><tr><th>#</th><th>Phase</th><th>Duration</th><th>Role</th><th></th></tr></thead>
                  <tbody>
                    {[...template.phases].sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((phase) => (
                      <tr key={phase.id}>
                        <td>{phase.sequenceOrder}</td>
                        <td>{phase.phaseName}</td>
                        <td>{phase.durationMode === "fixed_hours" ? `${phase.fixedHours ?? 0}h fixed` : `per BOM unit (${phase.bomCategoryFilter})`}</td>
                        <td>{phase.defaultRole || "-"}</td>
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

        <section className="panel wide">
          <PanelHeader title="Form Builder - After-Sales Handover" label="Add, edit, reorder, or remove handover questions with no code change" />
          {formBuilderStatus && <small className="muted">{formBuilderStatus}</small>}
          {!handoverSchema ? (
            <div className="empty-compact-state">Loading form schema...</div>
          ) : (
            <>
              <table>
                <thead><tr><th>#</th><th>Section</th><th>Label</th><th>Type</th><th>Required</th><th></th></tr></thead>
                <tbody>
                  {[...handoverSchema.fields].sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((field, index, sorted) => (
                    <tr key={field.id}>
                      <td>{field.sequenceOrder}</td>
                      <td>{field.section}</td>
                      <td>{field.label}{field.fieldType === "select" && field.options.length > 0 ? ` [${field.options.join(" | ")}]` : ""}</td>
                      <td>{field.fieldType}</td>
                      <td>
                        <label className="checkbox-inline">
                          <input type="checkbox" checked={field.isRequired} onChange={(event) => onUpdateFormField(field.id, { isRequired: event.target.checked })} />
                        </label>
                      </td>
                      <td>
                        <button className="secondary-action mini-action" type="button" disabled={index === 0} onClick={() => onReorderFormField(field.id, "up")}>&uarr;</button>{" "}
                        <button className="secondary-action mini-action" type="button" disabled={index === sorted.length - 1} onClick={() => onReorderFormField(field.id, "down")}>&darr;</button>{" "}
                        <button className="secondary-action mini-action" type="button" onClick={() => onDeleteFormField(field.id)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                  {handoverSchema.fields.length === 0 && <tr><td colSpan={6} className="empty-compact-state">No questions yet.</td></tr>}
                </tbody>
              </table>
              <div className="roster-add-row">
                <input value={formFieldDraft.section} onChange={(event) => setFormFieldDraft((current) => ({ ...current, section: event.target.value }))} placeholder="Section (e.g. site_requirements)" />
                <input value={formFieldDraft.label} onChange={(event) => setFormFieldDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Question label" />
                <select value={formFieldDraft.fieldType} onChange={(event) => setFormFieldDraft((current) => ({ ...current, fieldType: event.target.value as FormSchemaField["fieldType"] }))}>
                  <option value="text">Text</option>
                  <option value="textarea">Paragraph</option>
                  <option value="number">Number</option>
                  <option value="select">Dropdown</option>
                  <option value="checkbox">Checkbox</option>
                  <option value="date">Date</option>
                </select>
                {formFieldDraft.fieldType === "select" ? (
                  <input value={formFieldDraft.optionsRaw} onChange={(event) => setFormFieldDraft((current) => ({ ...current, optionsRaw: event.target.value }))} placeholder="Option A, Option B, Option C" />
                ) : (
                  <input value={formFieldDraft.placeholder} onChange={(event) => setFormFieldDraft((current) => ({ ...current, placeholder: event.target.value }))} placeholder="Placeholder text" />
                )}
                <label className="checkbox-inline-field">
                  <input type="checkbox" checked={formFieldDraft.isRequired} onChange={(event) => setFormFieldDraft((current) => ({ ...current, isRequired: event.target.checked }))} />
                  Required
                </label>
                <button
                  className="primary-action mini-action"
                  type="button"
                  disabled={!formFieldDraft.label.trim()}
                  onClick={() => {
                    onAddFormField({
                      section: formFieldDraft.section || "general",
                      fieldKey: `field_${Date.now().toString(36)}`,
                      label: formFieldDraft.label,
                      fieldType: formFieldDraft.fieldType,
                      placeholder: formFieldDraft.placeholder,
                      isRequired: formFieldDraft.isRequired,
                      options: formFieldDraft.fieldType === "select" ? formFieldDraft.optionsRaw.split(",").map((option) => option.trim()).filter(Boolean) : [],
                      sequenceOrder: handoverSchema.fields.length,
                    });
                    setFormFieldDraft({ section: formFieldDraft.section, label: "", fieldType: "text", placeholder: "", isRequired: false, optionsRaw: "" });
                  }}
                >
                  <Plus size={14} /> Add Question
                </button>
              </div>
            </>
          )}
        </section>

        <section className="panel wide">
          <PanelHeader title="Pre-Sales Rules" label="Baseline hardware derived from tier, node count, and cloud sync at the quoting stage" />
          {presalesStatus && <small className="muted">{presalesStatus}</small>}
          <table>
            <thead><tr><th>Tier</th><th>Item</th><th>Quantity</th><th>Cloud Sync</th><th></th></tr></thead>
            <tbody>
              {presalesRules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.tier}</td>
                  <td>{rule.baseItemName}</td>
                  <td>{rule.quantityMode === "per_node_ceil" ? `ceil(nodes / ${rule.perNodeDivisor})` : `${rule.fixedQty} fixed`}</td>
                  <td>{rule.requiresCloudSync === null ? "Any" : rule.requiresCloudSync ? "Required" : "No"}</td>
                  <td><button className="secondary-action mini-action" type="button" onClick={() => onDeletePresalesRule(rule.id)}>Remove</button></td>
                </tr>
              ))}
              {presalesRules.length === 0 && <tr><td colSpan={5} className="empty-compact-state">No rules yet.</td></tr>}
            </tbody>
          </table>
          <div className="roster-add-row">
            <input value={presalesRuleDraft.tier} onChange={(event) => setPresalesRuleDraft((current) => ({ ...current, tier: event.target.value }))} placeholder="Tier (e.g. Commercial Office)" />
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
        </>
      )}

      {isAdmin && (
        <section className="panel wide">
          <PanelHeader title="Admin" label="Assign roles, tab access, and admin rights for every user who has signed in" />
          <div className="report-filter-row">
            <button className="secondary-action mini-action" type="button" onClick={onRefresh}>Refresh directory</button>
            {status && <span className="muted">{status}</span>}
          </div>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Tab access</th>
                <th>Admin</th>
                <th>Approval</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {knownUsers.map((user) => {
                const isUserAdmin = adminIds.includes(user.userId);
                const approval = approvalByUserId.get(user.userId);
                const override = allowedViewsMap[user.userId] ?? null;
                const effectiveViews = override && override.length > 0 ? override : DEFAULT_TABS_BY_ROLE[(userRoleMap[user.userId] as RoleMode) ?? "warehouse"];
                return (
                  <tr key={user.userId}>
                    <td>{user.email}{user.userId === currentUserId ? " (you)" : ""}</td>
                    <td>
                      <select
                        value={userRoleMap[user.userId] ?? ""}
                        onChange={(event) => onSetRole(user.userId, event.target.value)}
                      >
                        <option value="" disabled>Not set</option>
                        {ROLE_KEY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
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
                      {approval?.approvalStatus ?? "-"}
                      {approval?.expiresAt ? ` (until ${new Date(approval.expiresAt).toLocaleDateString()})` : ""}
                    </td>
                    <td>{new Date(user.lastSeenAt).toLocaleString()}</td>
                  </tr>
                );
              })}
              {knownUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-compact-state">
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
  salesQuotes,
  salesQuoteStatus,
  onCreateSalesQuote,
  onAddSalesQuoteLocation,
  onUpdateSalesQuoteLocation,
  onUploadSalesQuoteImage,
  onDownloadSalesQuoteImage,
  projectSites,
  tasks,
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
  salesQuotes: SalesQuote[];
  salesQuoteStatus: string;
  onCreateSalesQuote: (input: { clientName: string; siteName: string; city: string; garageCount: number; lotCount: number }) => void;
  onAddSalesQuoteLocation: (quoteId: string, locationType: "garage" | "lot") => void;
  onUpdateSalesQuoteLocation: (
    quoteId: string,
    locationId: string,
    updates: Partial<{ name: string; fli: boolean; lpr: boolean; peopleCounting: boolean; entriesCount: number; exitsCount: number; levelsCount: number }>,
  ) => void;
  onUploadSalesQuoteImage: (quoteId: string, locationId: string, imageType: "photo" | "drawing", file: File) => void;
  onDownloadSalesQuoteImage: (image: SalesQuoteLocationImage) => void;
  projectSites: ProjectSite[];
  tasks: EOTask[];
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">) => void;
  onUpdateTask: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => void;
  onDeleteTask: (id: string) => void;
  onOpenTasksView: () => void;
}) {
  // One combined review panel for both Catalog and Quote Builder tasks --
  // no Add here (that lives inside each area below, see RequestTaskButton),
  // this is purely "what's still open, across Sales, for a quick reference."
  const combinedSalesTasks = tasks.filter((task) => task.section === "sales_catalog" || task.section === "sales_quotes");

  return (
    <div className="content-grid">
      <TaskMiniPanel
        title="Sales Tasks"
        tasks={combinedSalesTasks}
        teamMembers={teamMembers}
        projectSites={projectSites}
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
            <h2>Sales</h2>
            <p>Product catalog reference and quote design for parking garage/lot sites.</p>
          </div>
        </div>
      </section>

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
        onUploadImage={onUploadSalesQuoteImage}
        onDownloadImage={onDownloadSalesQuoteImage}
        projectSites={projectSites}
        teamMembers={teamMembers}
        onCreateTask={onCreateTask}
      />
    </div>
  );
}

const EMPTY_CATALOG_DRAFT = {
  catalogNumber: "",
  productName: "",
  salesDescription: "",
  technicalDescription: "",
  category: "",
  manufacturer: "",
  defaultSellPrice: 0,
  costSource: "manual" as CatalogItem["costSource"],
  linkedReference: "",
  datasheetUrl: "",
  imageUrl: "",
  isRetired: false,
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
  projectSites: ProjectSite[];
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_CATALOG_DRAFT);
  const [showRetired, setShowRetired] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<Array<Omit<CatalogItem, "id" | "catalogNumber">>>([]);
  const [importStatus, setImportStatus] = useState("");
  const [isCommittingImport, setIsCommittingImport] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const visibleItems = catalogItems.filter((item) => showRetired || !item.isRetired);

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
    });
    setModalOpen(true);
  }

  function submitDraft() {
    if (!draft.productName.trim()) {
      return;
    }
    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    setModalOpen(false);
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
          const category = asText(findKey("category"));
          const manufacturer = asText(findKey("manufacturer", "brand", "vendor"));
          const priceKey = findKey("default sell price", "sell price", "price");
          const defaultSellPrice = priceKey ? Number(row[priceKey]) || 0 : 0;
          const linkedReference = asText(findKey("linked reference", "linked sku", "sku", "equipment"));
          const datasheetUrl = asText(findKey("datasheet url", "datasheet", "datasheet link"));
          const imageUrl = asText(findKey("image url", "image", "image link"));
          const salesDescription = asText(findKey("sales description", "description"));
          const technicalDescription = asText(findKey("technical description", "specs", "technical notes"));
          const item: Omit<CatalogItem, "id" | "catalogNumber"> = {
            productName,
            category,
            manufacturer,
            defaultSellPrice,
            costSource: "manual",
            linkedReference,
            datasheetUrl,
            imageUrl,
            salesDescription,
            technicalDescription,
            isRetired: false,
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
    } catch (error) {
      setImportStatus("Could not parse that file. Make sure it's a valid .xlsx or .csv.");
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
      setImportRows([]);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Could not import catalog items.");
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
              <label className="checkbox-inline"><input type="checkbox" checked={showRetired} onChange={(event) => setShowRetired(event.target.checked)} /> Show retired</label>
              {!isConfigured && <span className="muted">Set Supabase env vars to manage the catalog.</span>}
              {!canManage && <span className="muted">Only Admins and Managers can add, edit, or retire catalog items.</span>}
              {status && <span className="muted">{status}</span>}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Catalog #</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Manufacturer</th>
                  <th>Sell Price</th>
                  <th>Linked Ref</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id} className={item.isRetired ? "muted-row" : ""}>
                    <td>{item.catalogNumber}</td>
                    <td>{item.productName}</td>
                    <td>{item.category}</td>
                    <td>{item.manufacturer}</td>
                    <td>{money(item.defaultSellPrice)}</td>
                    <td>{item.linkedReference}</td>
                    <td>{item.isRetired ? "Retired" : "Active"}</td>
                    <td>
                      {canManage && (
                        <>
                          <button className="secondary-action mini-action" type="button" onClick={() => openEditModal(item)}>Edit</button>
                          <button className="secondary-action mini-action" type="button" onClick={() => onSetRetired(item.id, !item.isRetired)}>
                            {item.isRetired ? "Reactivate" : "Retire"}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty-compact-state">
                      No catalog items yet. Add a product to start building the sales catalog.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
            <div className="bom-modal-grid">
              <label className="span-2">Product name<input value={draft.productName} onChange={(event) => setDraft((current) => ({ ...current, productName: event.target.value }))} placeholder="Product name" /></label>
              <label>Category<input value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="Category" /></label>
              <label>Manufacturer<input value={draft.manufacturer} onChange={(event) => setDraft((current) => ({ ...current, manufacturer: event.target.value }))} placeholder="Manufacturer" /></label>
              <label>Default sell price<input type="number" min={0} step="0.01" value={draft.defaultSellPrice} onChange={(event) => setDraft((current) => ({ ...current, defaultSellPrice: Number(event.target.value) }))} /></label>
              <label>Cost source<select value={draft.costSource} onChange={(event) => setDraft((current) => ({ ...current, costSource: event.target.value as CatalogItem["costSource"] }))}>
                <option value="manual">Manual</option>
                <option value="inventory_unit_cost">Inventory unit cost</option>
                <option value="vendor_quote">Vendor quote</option>
              </select></label>
              <label className="span-2">Linked SKU / equipment<input value={draft.linkedReference} onChange={(event) => setDraft((current) => ({ ...current, linkedReference: event.target.value }))} placeholder="e.g. SKU-1234 or VPU Server Recipe" /></label>
              <label className="span-2">Sales description<textarea value={draft.salesDescription} onChange={(event) => setDraft((current) => ({ ...current, salesDescription: event.target.value }))} placeholder="Customer-facing description for quotes" /></label>
              <label className="span-2">Technical description<textarea value={draft.technicalDescription} onChange={(event) => setDraft((current) => ({ ...current, technicalDescription: event.target.value }))} placeholder="Specs, dimensions, technical notes" /></label>
              <label>Datasheet URL<input value={draft.datasheetUrl} onChange={(event) => setDraft((current) => ({ ...current, datasheetUrl: event.target.value }))} placeholder="Link to a datasheet" /></label>
              <label>Image URL<input value={draft.imageUrl} onChange={(event) => setDraft((current) => ({ ...current, imageUrl: event.target.value }))} placeholder="Product image link" /></label>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setModalOpen(false)}>Cancel</button>
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
            {importStatus && <small className="muted">{importStatus}</small>}
            {importRows.length > 0 && (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Manufacturer</th>
                      <th>Sell Price</th>
                      <th>Linked Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, index) => (
                      <tr key={index}>
                        <td>{row.productName}</td>
                        <td>{row.category}</td>
                        <td>{row.manufacturer}</td>
                        <td>{money(row.defaultSellPrice)}</td>
                        <td>{row.linkedReference}</td>
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
    </>
  );
}

const EMPTY_NEW_QUOTE_DRAFT = { clientName: "", siteName: "", city: "", garageCount: 1, lotCount: 0 };

// Sale Design and Quote Builder. A quote starts with a client/site and a
// count of garages and parking lots -- entering those counts generates one
// location line item per garage/lot (see onCreateQuote/handleCreateSalesQuote
// in the App component) for the sales person to name and detail. The
// "Recommended Hardware" block per location is a deliberate placeholder: E
// asked for the inputs (FLI/LPR/people counting, entries/exits/levels) to
// exist now, with the rules engine that turns them into a camera/sign count
// built next -- it is not decorative, it is explicitly staged.
function SalesQuoteBuilder({
  salesQuotes,
  status,
  isConfigured,
  onCreateQuote,
  onAddLocation,
  onUpdateLocation,
  onUploadImage,
  onDownloadImage,
  projectSites,
  teamMembers,
  onCreateTask,
}: {
  salesQuotes: SalesQuote[];
  status: string;
  isConfigured: boolean;
  onCreateQuote: (input: { clientName: string; siteName: string; city: string; garageCount: number; lotCount: number }) => void;
  onAddLocation: (quoteId: string, locationType: "garage" | "lot") => void;
  onUpdateLocation: (
    quoteId: string,
    locationId: string,
    updates: Partial<{ name: string; fli: boolean; lpr: boolean; peopleCounting: boolean; entriesCount: number; exitsCount: number; levelsCount: number }>,
  ) => void;
  onUploadImage: (quoteId: string, locationId: string, imageType: "photo" | "drawing", file: File) => void;
  onDownloadImage: (image: SalesQuoteLocationImage) => void;
  projectSites: ProjectSite[];
  teamMembers: TeamMember[];
  onCreateTask: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">) => void;
}) {
  const [mode, setMode] = useState<"list" | "detail">("list");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [showNewQuoteModal, setShowNewQuoteModal] = useState(false);
  const [newQuoteDraft, setNewQuoteDraft] = useState(EMPTY_NEW_QUOTE_DRAFT);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const selectedQuote = salesQuotes.find((quote) => quote.id === selectedQuoteId) ?? null;
  const selectedLocation = selectedQuote?.locations.find((location) => location.id === selectedLocationId) ?? null;

  function openQuote(id: string) {
    setSelectedQuoteId(id);
    setMode("detail");
  }

  function backToList() {
    setMode("list");
    setSelectedLocationId(null);
  }

  function submitNewQuote() {
    if (!newQuoteDraft.clientName.trim() || !newQuoteDraft.siteName.trim()) {
      return;
    }
    onCreateQuote(newQuoteDraft);
    setNewQuoteDraft(EMPTY_NEW_QUOTE_DRAFT);
    setShowNewQuoteModal(false);
  }

  function handleImageSelect(locationId: string, imageType: "photo" | "drawing", event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && selectedQuote) {
      onUploadImage(selectedQuote.id, locationId, imageType, file);
    }
    event.target.value = "";
  }

  return (
    <>
      <section className="panel wide">
        <div className="panel-title-row">
          <div>
            <h2>Quote Builder</h2>
            <p>Scope a client's garages and parking lots, then build a hardware quote.</p>
          </div>
          <button className="icon-button" type="button" onClick={() => setIsCollapsed((current) => !current)} aria-label={isCollapsed ? "Expand section" : "Collapse section"}>
            {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>
      </section>

      {!isCollapsed && mode === "list" && (
        <section className="panel wide">
          <div className="panel-title-row">
            <div>
              <p>Sale Design and Quote Builder</p>
            </div>
            <button className="primary-action mini-action" type="button" onClick={() => setShowNewQuoteModal(true)} disabled={!isConfigured}>
              <Plus size={14} /> Add New
            </button>
          </div>
          {!isConfigured && <span className="muted">Set Supabase env vars to manage quotes.</span>}
          {status && <small className="muted">{status}</small>}
          <table>
            <thead>
              <tr><th>Name</th><th>City</th><th>Sales Person</th><th>Locations</th><th></th></tr>
            </thead>
            <tbody>
              {salesQuotes.map((quote) => (
                <tr key={quote.id}>
                  <td><strong>{quote.siteName}</strong><small>{quote.clientName}</small></td>
                  <td>{quote.city || "-"}</td>
                  <td>{quote.createdByEmail || "-"}</td>
                  <td>{quote.locations.length}</td>
                  <td><button className="table-action" type="button" onClick={() => openQuote(quote.id)}>Open</button></td>
                </tr>
              ))}
              {salesQuotes.length === 0 && (
                <tr><td colSpan={5} className="empty-compact-state">No quotes yet. Add New to start scoping a site.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {!isCollapsed && mode === "detail" && selectedQuote && (
        <section className="panel wide">
          <div className="panel-title-row">
            <div>
              <button className="secondary-action mini-action" type="button" onClick={backToList}>&larr; Back to quotes</button>
              <h2>{selectedQuote.siteName}</h2>
              <p>{selectedQuote.clientName} - {selectedQuote.city || "No city set"} - Started by {selectedQuote.createdByEmail || "Unknown"}</p>
            </div>
            <div className="report-filter-row">
              <button className="secondary-action mini-action" type="button" onClick={() => onAddLocation(selectedQuote.id, "garage")}>+ Garage</button>
              <button className="secondary-action mini-action" type="button" onClick={() => onAddLocation(selectedQuote.id, "lot")}>+ Lot</button>
              <RequestTaskButton
                section="sales_quotes"
                contextNote={`Regarding quote: ${selectedQuote.siteName} (${selectedQuote.clientName})`}
                teamMembers={teamMembers}
                projectSites={projectSites}
                onCreate={onCreateTask}
              />
            </div>
          </div>
          <table>
            <thead>
              <tr><th>Type</th><th>Name</th><th>Photos / Drawings</th><th></th></tr>
            </thead>
            <tbody>
              {selectedQuote.locations.map((location) => (
                <tr key={location.id}>
                  <td><span className={`status ${location.locationType === "garage" ? "ok" : ""}`}>{location.locationType === "garage" ? "Garage" : "Lot"}</span></td>
                  <td>
                    <input
                      className="quote-location-row-name"
                      value={location.name}
                      onChange={(event) => onUpdateLocation(selectedQuote.id, location.id, { name: event.target.value })}
                      placeholder={location.locationType === "garage" ? "Garage name" : "Lot name"}
                    />
                  </td>
                  <td>
                    <label className="secondary-action mini-action hidden-file-label">
                      <Camera size={14} /> Take Photo
                      <input type="file" accept="image/*" capture="environment" onChange={(event) => handleImageSelect(location.id, "photo", event)} />
                    </label>
                    <label className="secondary-action mini-action hidden-file-label">
                      <Upload size={14} /> Upload
                      <input type="file" accept="image/*,.pdf" onChange={(event) => handleImageSelect(location.id, "drawing", event)} />
                    </label>
                    <small>{location.images.length} file{location.images.length === 1 ? "" : "s"}</small>
                  </td>
                  <td><button className="table-action" type="button" onClick={() => setSelectedLocationId(location.id)}>Details</button></td>
                </tr>
              ))}
              {selectedQuote.locations.length === 0 && (
                <tr><td colSpan={4} className="empty-compact-state">No garages or lots yet. Use + Garage / + Lot above.</td></tr>
              )}
            </tbody>
          </table>
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
              <label className="checkbox-inline span-2">
                <input type="checkbox" checked={selectedLocation.fli} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { fli: event.target.checked })} /> FLI
              </label>
              <label className="checkbox-inline span-2">
                <input type="checkbox" checked={selectedLocation.lpr} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { lpr: event.target.checked })} /> LPR
              </label>
              <label className="checkbox-inline span-2">
                <input type="checkbox" checked={selectedLocation.peopleCounting} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { peopleCounting: event.target.checked })} /> People counting
              </label>
              <label>Entries<input type="number" min={0} value={selectedLocation.entriesCount} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { entriesCount: Number(event.target.value) || 0 })} /></label>
              <label>Exits<input type="number" min={0} value={selectedLocation.exitsCount} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { exitsCount: Number(event.target.value) || 0 })} /></label>
              <label>Levels<input type="number" min={0} value={selectedLocation.levelsCount} onChange={(event) => onUpdateLocation(selectedQuote.id, selectedLocation.id, { levelsCount: Number(event.target.value) || 0 })} /></label>
            </div>
            <div className="note-list">
              <p><strong>Recommended Hardware</strong> -- rules engine coming next. Once built, this will size cameras, signs, and related hardware from the checkboxes and counts above.</p>
            </div>
            {selectedLocation.images.length > 0 && (
              <div className="line-list">
                {selectedLocation.images.map((image) => (
                  <div className="line-item" key={image.id}>
                    <div>
                      <strong>{image.fileName || (image.imageType === "photo" ? "Photo" : "Drawing")}</strong>
                      <span>{image.imageType === "photo" ? "Photo" : "Drawing"}</span>
                    </div>
                    <button className="secondary-action mini-action" type="button" onClick={() => onDownloadImage(image)}>View</button>
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

      {showNewQuoteModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-quote-title">
            <div className="modal-header">
              <div>
                <h2 id="new-quote-title">New Quote</h2>
                <p>Garage/lot counts create line items below to name individually after creating.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowNewQuoteModal(false)} aria-label="Close new quote form">x</button>
            </div>
            <div className="bom-modal-grid">
              <label className="span-2">Client name<input value={newQuoteDraft.clientName} onChange={(event) => setNewQuoteDraft((current) => ({ ...current, clientName: event.target.value }))} placeholder="Client name" /></label>
              <label className="span-2">Site name<input value={newQuoteDraft.siteName} onChange={(event) => setNewQuoteDraft((current) => ({ ...current, siteName: event.target.value }))} placeholder="Site name" /></label>
              <label>City<input value={newQuoteDraft.city} onChange={(event) => setNewQuoteDraft((current) => ({ ...current, city: event.target.value }))} placeholder="City" /></label>
              <label>Garages<input type="number" min={0} value={newQuoteDraft.garageCount} onChange={(event) => setNewQuoteDraft((current) => ({ ...current, garageCount: Number(event.target.value) || 0 }))} /></label>
              <label>Parking lots<input type="number" min={0} value={newQuoteDraft.lotCount} onChange={(event) => setNewQuoteDraft((current) => ({ ...current, lotCount: Number(event.target.value) || 0 }))} /></label>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowNewQuoteModal(false)}>Cancel</button>
              <button className="primary-action" type="button" onClick={submitNewQuote} disabled={!newQuoteDraft.clientName.trim() || !newQuoteDraft.siteName.trim()}>Create Quote</button>
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
  isInternal: true,
  status: "to_do" as TaskStatus,
  priority: "normal" as TaskPriority,
  category: "",
  impactAreas: [] as string[],
  assigneeUserId: null as string | null,
  assigneeEmail: "",
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
  teamMembers,
  projectSites,
  onCreate,
}: {
  section: TaskSection;
  contextNote?: string;
  teamMembers: TeamMember[];
  projectSites: ProjectSite[];
  onCreate: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);

  function openModal() {
    setDraft({ ...EMPTY_TASK_DRAFT, section, isInternal: true, description: contextNote ?? "" });
    setOpen(true);
  }

  function submit() {
    if (!draft.title.trim()) {
      return;
    }
    onCreate(draft);
    setOpen(false);
  }

  return (
    <>
      <button className="secondary-action mini-action" type="button" onClick={openModal}>
        <Plus size={14} /> Request
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
  return (task.assigneeEmail || "") === key;
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
  projectSites: ProjectSite[];
  teamMembers: TeamMember[];
  onSubmit: () => void;
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
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
        <div className="modal-header">
          <div>
            <h2 id="task-editor-title">{editingId ? "Edit Task" : "Add Task"}</h2>
            <p>Track work across sections and, when relevant, a specific project.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close task editor">x</button>
        </div>
        <div className="bom-modal-grid">
          <label className="span-2">Title<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Task title" /></label>
          {lockSection ? (
            <label>Section<input value={TASK_SECTION_OPTIONS.find((option) => option.value === draft.section)?.label ?? draft.section} disabled /></label>
          ) : (
            <label>Section<select value={draft.section} onChange={(event) => setDraft((current) => ({ ...current, section: event.target.value as TaskSection }))}>
              {TASK_SECTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select></label>
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
          <label>Assignee<AssigneeSelect value={draft.assigneeEmail} teamMembers={teamMembers} onChange={(email) => setDraft((current) => ({ ...current, assigneeEmail: email }))} /></label>
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

        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="button" onClick={onSubmit} disabled={!draft.title.trim()}>{editingId ? "Save Task" : "Add Task"}</button>
        </div>
      </section>
    </div>
  );
}

function TaskCard({ task, teamMembers, onUpdate, onEdit, onDelete, showStatusMove }: { task: EOTask; teamMembers: TeamMember[]; onUpdate: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => void; onEdit: () => void; onDelete: () => void; showStatusMove?: boolean }) {
  return (
    <div className="task-card">
      <div className="task-card-top">
        <span className={priorityBadgeClass(task.priority)}>{task.priority}</span>
        {task.dueDate && <span className="task-card-due">{task.dueDate}</span>}
      </div>
      <strong className="task-card-title">{task.title}</strong>
      <div className="task-card-meta">
        <span>{assigneeLabel(task.assigneeEmail, teamMembers)}</span>
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

  return (
    <div className="task-calendar">
      <div className="task-calendar-header">
        <button className="secondary-action mini-action" type="button" onClick={() => setMonthCursor(new Date(year, month - 1, 1))}>&lt;</button>
        <strong>{monthLabel}</strong>
        <button className="secondary-action mini-action" type="button" onClick={() => setMonthCursor(new Date(year, month + 1, 1))}>&gt;</button>
      </div>
      <div className="task-calendar-grid task-calendar-weekdays">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="task-calendar-grid">
        {cells.map((day, index) => (
          <div key={index} className={`task-calendar-cell ${day === null ? "is-empty" : ""}`}>
            {day !== null && (
              <>
                <span className="task-calendar-day">{day}</span>
                {(tasksByDay.get(day) ?? []).slice(0, 3).map((task) => (
                  <button key={task.id} className={`task-calendar-chip priority-${task.priority}`} type="button" onClick={() => onSelectTask(task)}>
                    {task.title}
                  </button>
                ))}
                {(tasksByDay.get(day) ?? []).length > 3 && (
                  <span className="muted">+{(tasksByDay.get(day) ?? []).length - 3} more</span>
                )}
              </>
            )}
          </div>
        ))}
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
}: {
  tasks: EOTask[];
  projectSites: ProjectSite[];
  teamMembers: TeamMember[];
  status: string;
  onCreate: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">) => void;
  onUpdate: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  inventoryItems?: Part[];
  taskHardwareDependencies?: TaskHardwareDependency[];
  onAddTaskDependency?: (taskId: string, sku: string, qty: number) => void;
  onDeleteTaskDependency?: (id: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [sectionFilter, setSectionFilter] = useState<"all" | TaskSection>("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<"list" | "board" | "calendar" | "gantt">("list");
  const [groupBy, setGroupBy] = useState<TaskGroupBy>("status");
  const [personFilter, setPersonFilter] = useState("");

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
      isInternal: task.isInternal,
      status: task.status,
      priority: task.priority,
      category: task.category,
      impactAreas: task.impactAreas,
      assigneeUserId: task.assigneeUserId,
      assigneeEmail: task.assigneeEmail,
      startDate: task.startDate,
      dueDate: task.dueDate,
    });
    setModalOpen(true);
  }

  function submitDraft() {
    if (!draft.title.trim()) {
      return;
    }
    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    setModalOpen(false);
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
                        <td>{assigneeLabel(task.assigneeEmail, teamMembers)}</td>
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
  teamMembers: TeamMember[];
  projectSites: ProjectSite[];
  section?: TaskSection;
  projectRef?: string;
  isInternal?: boolean;
  hideAdd?: boolean;
  onCreate: (task: Omit<EOTask, "id" | "taskNumber" | "createdBy" | "createdAt" | "completedAt">) => void;
  onUpdate: (id: string, task: Partial<Omit<EOTask, "id" | "taskNumber">>) => void;
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
      isInternal: task.isInternal,
      status: task.status,
      priority: task.priority,
      category: task.category,
      impactAreas: task.impactAreas,
      assigneeUserId: task.assigneeUserId,
      assigneeEmail: task.assigneeEmail,
      startDate: task.startDate,
      dueDate: task.dueDate,
    });
    setModalOpen(true);
  }

  function submitDraft() {
    if (!draft.title.trim()) {
      return;
    }
    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    setModalOpen(false);
  }

  return (
    <section className="panel task-mini-panel wide">
      <div className="panel-title-row">
        <div>
          <h2>{title}</h2>
          <p>{openTasks.length} open{tasks.length !== openTasks.length ? `, ${tasks.length - openTasks.length} done` : ""}</p>
        </div>
        <div className="action-row">
          <button className="secondary-action mini-action" type="button" onClick={onOpenFull}>Open in Tasks</button>
          {!hideAdd && (
            <button className="primary-action mini-action" type="button" onClick={openAddModal}><Plus size={14} /> Add</button>
          )}
        </div>
      </div>
      <div className="task-mini-list">
        {visibleTasks.map((task) => (
          <button key={task.id} className="task-mini-row" type="button" onClick={() => openEditModal(task)}>
            <span className={`status-pill status-${task.status}`}>{TASK_STATUS_OPTIONS.find((option) => option.value === task.status)?.label ?? task.status}</span>
            <span className="task-mini-row-title">{task.title}</span>
            <span className="muted">{assigneeLabel(task.assigneeEmail, teamMembers)}</span>
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
}: {
  title: string;
  label: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  return (
    <header className="panel-header">
      <div><h2>{title}</h2><p>{label}</p></div>
      {onToggleCollapse ? (
        <button className="icon-button" type="button" onClick={onToggleCollapse} aria-label={collapsed ? "Expand section" : "Collapse section"}>
          {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
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
        <table>
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

const submittalToken = new URLSearchParams(window.location.search).get("submittal");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {submittalToken ? <SubmittalPublicPage token={submittalToken} /> : <App />}
  </StrictMode>
);

