import { StrictMode, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardList,
  DollarSign,
  ExternalLink,
  FileText,
  FolderOpen,
  Image,
  LayoutDashboard,
  MapPin,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  Upload,
  User,
} from "lucide-react";
import { isRemotePersistenceConfigured, loadLocalAppState, loadRemoteAppState, saveLocalAppState, saveRemoteAppState, type PersistedAppState } from "./persistence";
import "./styles.css";

type View = "dashboard" | "purchasing" | "inventory" | "projects" | "reports";

type PurchaseUrl = {
  id: number;
  label: string;
  url: string;
};

type PriceHistoryEntry = {
  id: number;
  date: string;
  vendor: string;
  unitCost: number;
  notes: string;
};

const inventoryTags = ["VPU Part", "Edge Box Part", "Solar Part", "Server Part", "Network Part", "Power Part", "Field Hardware"];

type Part = {
  ref: string;
  name: string;
  description: string;
  manufacturer: string;
  category: "Base" | "Communications" | "Power" | "Lighting" | "Display" | "Build";
  cost: number;
  stock: number;
  reorderPoint: number;
  vendorUrl?: string;
  imageUrl?: string;
  barcode?: string;
  purchaseUrls?: PurchaseUrl[];
  priceHistory?: PriceHistoryEntry[];
  tags?: string[];
  retired?: boolean;
};

type BuildComponent = {
  itemName: string;
  qty: number;
};

type BuildRecipe = {
  name: string;
  outputName: string;
  description: string;
  imageUrl?: string;
  components: BuildComponent[];
  retired?: boolean;
};

type RoleMode = "warehouse" | "purchasing" | "pm" | "manager";
type SyncStatus = "local" | "loading" | "saving" | "synced" | "error";

type InventoryMovement = {
  id: string;
  type: "receive" | "transfer" | "build_consume" | "build_complete" | "adjust" | "retire" | "reactivate" | "undo";
  sku: string;
  itemName: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  projectName?: string;
  poNumber?: string;
  buildNumber?: string;
  source: "inventory" | "project" | "purchasing" | "equipment";
  notes: string;
  createdAt: string;
};

type BuildTransaction = {
  id: string;
  buildNumber: string;
  equipmentName: string;
  quantityBuilt: number;
  componentMovements: InventoryMovement[];
  completionMovement?: InventoryMovement;
  status: "planned" | "posted" | "undone" | "cancelled";
  stage?: "planned" | "kitting" | "assembled" | "tested" | "complete";
  createdAt: string;
  undoneAt?: string;
};

type ProjectAllocationHistory = {
  id: string;
  projectName: string;
  projectRef?: string;
  sku: string;
  itemName: string;
  quantity: number;
  movementId: string;
  action: "allocated" | "returned" | "adjusted" | "undone";
  notes: string;
  createdAt: string;
};

type PackageOption = {
  name: string;
  condition: string;
  costWithoutCameras: number;
  items: string[];
};

type PurchaseLine = {
  name: string;
  category: "Compute" | "Storage" | "Network" | "Power" | "Enclosure" | "Hardware" | "Rack" | "Other";
  qty: number;
  unitCost: number;
  lineTotal?: number;
};

type PurchaseOrder = {
  number: string;
  vendor: "Amazon" | "NeweggBusiness";
  date: string;
  projectRef: "Straud Medical" | "Newport News" | "Newport News 37th St.";
  status: "Imported" | "In Processing" | "On Hold";
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  sourceFile: string;
  shipTo: string;
  paymentNote: string;
  lines: PurchaseLine[];
};

type UploadedDoc = {
  id: number;
  name: string;
  project: string;
  size: number;
  status: "Ready to review";
};

type BomLine = {
  item: string;
  qty: number;
  status: "Need Quote" | "Not started" | "Ordered" | "Completed" | "From Inventory" | "Delivered to Office" | "Delivered to Client";
  requestSpeed: "ASAP" | "Standard" | "Future";
  po?: string;
  notes?: string;
};

type ScopeOfWork = {
  summary: string;
  preparation: string;
  infrastructure: string;
  installation: string;
  commissioning: string;
  fineTuning: string;
  assumptions: string;
  exclusions: string;
};

type ProjectSite = {
  ref: string;
  name: string;
  client: string;
  type: "Parking Garage" | "Surface Lot" | "Campus Parking" | "Mixed Parking";
  address: string;
  owner: string;
  status: "Draft" | "Planning" | "Purchasing" | "Staging" | "Install Ready";
  due: string;
  package: string;
  cameras: number;
  allocated: number;
  siteNotes: string;
  salesQuoteFile?: string;
  sow: ScopeOfWork;
  bom: BomLine[];
};

type BomMaterialAction = "pull" | "order";

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

const purchaseOrders: PurchaseOrder[] = [
  {
    number: "1304622160",
    vendor: "NeweggBusiness",
    date: "Jul 15, 2026",
    projectRef: "Straud Medical",
    status: "In Processing",
    subtotal: 22436.95,
    tax: 1738.87,
    shipping: 0,
    total: 24175.82,
    sourceFile: "$24,175.82 NeweggBusiness.pdf",
    shipTo: "EnSight Technologies, Santee CA",
    paymentNote: "Visa ending 0950, payment verification pending",
    lines: [
      { name: "ASRock Z890 Taichi motherboard", category: "Compute", qty: 13, unitCost: 199.99, lineTotal: 2599.87 },
      { name: "Intel Core Ultra 7 270K Plus processor", category: "Compute", qty: 17, unitCost: 311.5, lineTotal: 5295.5 },
      { name: "CORSAIR RM1000x ATX power supply", category: "Power", qty: 14, unitCost: 217.99, lineTotal: 3051.86 },
      { name: "Rosewill 2U rackmount server chassis", category: "Rack", qty: 13, unitCost: 149.99, lineTotal: 1949.87 },
      { name: "GIGABYTE WindForce RTX 5070 graphics card", category: "Compute", qty: 15, unitCost: 635.99, lineTotal: 9539.85 },
    ],
  },
  {
    number: "1304622180",
    vendor: "NeweggBusiness",
    date: "Jul 15, 2026",
    projectRef: "Straud Medical",
    status: "In Processing",
    subtotal: 3112.72,
    tax: 241.24,
    shipping: 0,
    total: 3353.96,
    sourceFile: "3,353.96 NeweggBusiness.pdf",
    shipTo: "EnSight Technologies, Santee CA",
    paymentNote: "Visa ending 0950, payment verification pending",
    lines: [
      { name: "Samsung 990 PRO SSD 1TB M.2 drive", category: "Storage", qty: 13, unitCost: 239.44, lineTotal: 3112.72 },
    ],
  },
  {
    number: "1304622200",
    vendor: "NeweggBusiness",
    date: "Jul 15, 2026",
    projectRef: "Straud Medical",
    status: "On Hold",
    subtotal: 1040,
    tax: 80.6,
    shipping: 0,
    total: 1120.6,
    sourceFile: "1,120.60 NeweggBusiness.pdf",
    shipTo: "EnSight Technologies, Santee CA",
    paymentNote: "Visa ending 0950, order hold",
    lines: [
      { name: "Seagate Desktop HDD 2TB SATA internal drive", category: "Storage", qty: 13, unitCost: 80, lineTotal: 1040 },
    ],
  },
  {
    number: "112-0918552-2711412",
    vendor: "Amazon",
    date: "Jul 13, 2026",
    projectRef: "Newport News",
    status: "Imported",
    subtotal: 3178.84,
    tax: 246.35,
    shipping: 0,
    total: 3425.19,
    sourceFile: "AMZ $3,286.24 and 138.pdf",
    shipTo: "10225 Prospect Ave, Santee CA",
    paymentNote: "Visa ending 0950 split transactions",
    lines: [
      { name: "AC Infinity AXIAL 8038 cooling fan", category: "Enclosure", qty: 7, unitCost: 18.42 },
      { name: "Bud Industries IPV-1116 air vent", category: "Enclosure", qty: 20, unitCost: 11.99 },
      { name: "VEVOR NEMA 4X steel electrical enclosure", category: "Enclosure", qty: 19, unitCost: 147.9 },
    ],
  },
  {
    number: "112-5785858-5127443",
    vendor: "Amazon",
    date: "Jun 4, 2026",
    projectRef: "Newport News 37th St.",
    status: "Imported",
    subtotal: 1298.51,
    tax: 107.13,
    shipping: 0,
    total: 1405.64,
    sourceFile: "AMZ $790.20 and 615.pdf",
    shipTo: "971 Laguna Ave, El Cajon CA",
    paymentNote: "Visa ending 0950 split transactions",
    lines: [
      { name: "Self-drilling screw assortment kit", category: "Hardware", qty: 1, unitCost: 7.59 },
      { name: "OM4 LC to LC fiber patch cable", category: "Network", qty: 1, unitCost: 6.83 },
      { name: "ICC CAT6 wall mount patch panel", category: "Network", qty: 1, unitCost: 53.1 },
      { name: "Outdoor electrical box with fan and thermostat", category: "Enclosure", qty: 1, unitCost: 169.99 },
      { name: "Aluminum DIN rails, 30 piece pack", category: "Hardware", qty: 1, unitCost: 18.99 },
      { name: "10GBase-LR SFP+ transceiver pack", category: "Network", qty: 1, unitCost: 94.89 },
      { name: "Self tapping screw kit", category: "Hardware", qty: 1, unitCost: 7.98 },
      { name: "Goldenmate lithium UPS battery backup", category: "Power", qty: 1, unitCost: 175.99 },
      { name: "Cat6/Cat6a 1ft patch cables, 24 pack", category: "Network", qty: 1, unitCost: 19.94 },
      { name: "Screw mount zip tie anchors", category: "Hardware", qty: 1, unitCost: 14.23 },
      { name: "TRENDnet 240W DIN-rail power supply", category: "Power", qty: 1, unitCost: 168.99 },
      { name: "TRENDnet 26-port industrial PoE switch", category: "Network", qty: 1, unitCost: 559.99 },
    ],
  },
  {
    number: "112-4648611-7664246",
    vendor: "Amazon",
    date: "Jul 14, 2026",
    projectRef: "Newport News",
    status: "Imported",
    subtotal: 918,
    tax: 55.08,
    shipping: 0,
    total: 973.08,
    sourceFile: "amz 973.08.pdf",
    shipTo: "10225 Prospect Ave, Santee CA",
    paymentNote: "Visa ending 0950",
    lines: [
      { name: "Tecmojo 42U server rack network cabinet", category: "Rack", qty: 1, unitCost: 918, lineTotal: 918 },
    ],
  },
  {
    number: "112-8691883-8231436",
    vendor: "Amazon",
    date: "Jul 8, 2026",
    projectRef: "Newport News",
    status: "Imported",
    subtotal: 73.49,
    tax: 6.06,
    shipping: 0,
    total: 79.55,
    sourceFile: "AMZ 79.55.pdf",
    shipTo: "10225 Prospect Ave, Santee CA",
    paymentNote: "Visa ending 0950",
    lines: [
      { name: "19-inch rack mount for UCG-Fiber and UXG-Fiber", category: "Rack", qty: 1, unitCost: 73.49, lineTotal: 73.49 },
    ],
  },
];

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
    siteNotes: "Small surface lot demo project for the standard package matrix.",
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

function lineTotal(line: PurchaseLine) {
  return line.lineTotal ?? line.qty * line.unitCost;
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
  return ["dashboard", "purchasing", "inventory", "projects", "reports"].includes(viewKey) ? (viewKey as View) : "dashboard";
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

function movementNumber(index: number) {
  return `TXN-${String(index + 1).padStart(5, "0")}`;
}

function buildNumber(index: number) {
  return `BUILD-${String(index + 1).padStart(4, "0")}`;
}

function isArray<T>(value: unknown, fallback: T[]) {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function App() {
  const localState = loadLocalAppState();
  const [view, setView] = useState<View>(() => (window.location.hash ? viewFromHash() : savedView()));
  const [locationHash, setLocationHash] = useState(window.location.hash || window.localStorage.getItem("ergon:lastHash") || "#dashboard");
  const [inventoryItems, setInventoryItems] = useState<Part[]>(() => isArray<Part>(localState?.inventoryItems, parts));
  const [projectSites, setProjectSites] = useState<ProjectSite[]>(() => isArray<ProjectSite>(localState?.projectSites, projects));
  const [deviceRecipes, setDeviceRecipes] = useState<BuildRecipe[]>(() => isArray<BuildRecipe>(localState?.deviceRecipes, buildRecipes));
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>(() => isArray<InventoryMovement>(localState?.inventoryMovements, []));
  const [buildTransactions, setBuildTransactions] = useState<BuildTransaction[]>(() => isArray<BuildTransaction>(localState?.buildTransactions, []));
  const [projectAllocations, setProjectAllocations] = useState<ProjectAllocationHistory[]>(() => isArray<ProjectAllocationHistory>(localState?.projectAllocations, []));
  const [roleMode, setRoleMode] = useState<RoleMode>(() => ((localState?.roleMode as RoleMode | undefined) ?? "manager"));
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (isRemotePersistenceConfigured() ? "loading" : "local"));
  const lowStock = inventoryItems.filter((part) => !part.retired && part.stock <= part.reorderPoint);
  const inventoryValue = inventoryItems.reduce((sum, part) => sum + part.stock * part.cost, 0);
  const openPoValue = purchaseOrders.reduce((sum, po) => sum + po.total, 0);

  useEffect(() => {
    let cancelled = false;
    if (!isRemotePersistenceConfigured()) {
      setSyncStatus("local");
      return () => {
        cancelled = true;
      };
    }

    setSyncStatus("loading");
    loadRemoteAppState()
      .then((remoteState) => {
        if (!remoteState || cancelled) {
          if (!cancelled) {
            setSyncStatus("synced");
          }
          return;
        }
        setInventoryItems(isArray<Part>(remoteState.inventoryItems, parts));
        setProjectSites(isArray<ProjectSite>(remoteState.projectSites, projects));
        setDeviceRecipes(isArray<BuildRecipe>(remoteState.deviceRecipes, buildRecipes));
        setInventoryMovements(isArray<InventoryMovement>(remoteState.inventoryMovements, []));
        setBuildTransactions(isArray<BuildTransaction>(remoteState.buildTransactions, []));
        setProjectAllocations(isArray<ProjectAllocationHistory>(remoteState.projectAllocations, []));
        setRoleMode((remoteState.roleMode as RoleMode | undefined) ?? "manager");
        setSyncStatus("synced");
      })
      .catch(() => {
        // Local persistence remains active when Supabase is not configured yet.
        setSyncStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const state: PersistedAppState = {
      inventoryItems,
      projectSites,
      deviceRecipes,
      inventoryMovements,
      buildTransactions,
      projectAllocations,
      roleMode,
    };
    saveLocalAppState(state);
    if (!isRemotePersistenceConfigured()) {
      setSyncStatus("local");
      return;
    }
    setSyncStatus("saving");
    const syncTimer = window.setTimeout(() => {
      saveRemoteAppState(state)
        .then(() => setSyncStatus("synced"))
        .catch(() => {
          // Keep the UI usable offline or before Supabase keys are installed.
          setSyncStatus("error");
        });
    }, 650);
    return () => window.clearTimeout(syncTimer);
  }, [inventoryItems, projectSites, deviceRecipes, inventoryMovements, buildTransactions, projectAllocations, roleMode]);

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

  function pullFromInventory(itemName: string, qty: number) {
    setInventoryItems((current) =>
      current.map((part) => (part.name === itemName ? { ...part, stock: Math.max(0, part.stock - qty) } : part)),
    );
  }

  function addInventoryItem(part: Part) {
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
  }

  function updateInventoryItem(ref: string, nextPart: Part) {
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
  }

  function receiveInventoryStock(partRef: string, qty: number, unitCost: number, poNumber: string, notes: string) {
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
  }

  function adjustInventoryStock(partRef: string, nextQty: number, notes: string) {
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
  }

  function transferInventoryToProject(partRef: string, projectName: string, qty: number, notes: string) {
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
  }

  function undoBuildTransaction(buildId: string) {
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">E</div>
          <div>
            <div className="brand-title">Ergon</div>
            <div className="brand-subtitle">Ops Command</div>
          </div>
        </div>
        <nav className="nav-list">
          <NavButton icon={<LayoutDashboard size={18} />} label="Dashboard" active={view === "dashboard"} onClick={() => navigateToView("dashboard")} />
          <NavButton icon={<ShoppingCart size={18} />} label="Purchasing" active={view === "purchasing"} onClick={() => navigateToView("purchasing")} />
          <NavButton icon={<Boxes size={18} />} label="Inventory" active={view === "inventory"} onClick={() => navigateToView("inventory")} />
          <NavButton icon={<ClipboardList size={18} />} label="Projects" active={view === "projects"} onClick={() => navigateToView("projects")} />
          <NavButton icon={<BarChart3 size={18} />} label="Reports" active={view === "reports"} onClick={() => navigateToView("reports")} />
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{pageTitle(view)}</h1>
            <p>Purchasing, inventory, project transfers, and reports for field packages.</p>
          </div>
          <label className="role-mode-select">Role view<select value={roleMode} onChange={(event) => setRoleMode(event.target.value as RoleMode)}><option value="warehouse">Warehouse</option><option value="purchasing">Purchasing</option><option value="pm">PM</option><option value="manager">Manager</option></select></label>
          <div className={`sync-status ${syncStatus}`}>
            <span>{syncStatus === "local" ? "Local only" : syncStatus === "loading" ? "Cloud loading" : syncStatus === "saving" ? "Saving" : syncStatus === "synced" ? "Cloud synced" : "Sync issue"}</span>
          </div>
          <div className="search-box">
            <Search size={16} />
            <span>Search parts, POs, projects</span>
          </div>
        </header>

        {view === "dashboard" && <Dashboard roleMode={roleMode} projectSites={projectSites} lowStock={lowStock} inventoryValue={inventoryValue} openPoValue={openPoValue} buildTransactions={buildTransactions} inventoryMovements={inventoryMovements} />}
        {view === "purchasing" && <Purchasing projectSites={projectSites} />}
        {view === "inventory" && <Inventory roleMode={roleMode} inventoryItems={inventoryItems} lowStock={lowStock} projectSites={projectSites} deviceRecipes={deviceRecipes} setDeviceRecipes={setDeviceRecipes} buildTransactions={buildTransactions} inventoryMovements={inventoryMovements} onAddItem={addInventoryItem} onUpdateItem={updateInventoryItem} onReceiveStock={receiveInventoryStock} onAdjustStock={adjustInventoryStock} onTransferToProject={transferInventoryToProject} onPlanBuild={planBuildTransaction} onBuildInventoryUnit={buildInventoryUnit} onUndoBuildTransaction={undoBuildTransaction} onUpdateBuildStage={updateBuildStage} onCancelPlannedBuild={cancelPlannedBuild} />}
        {view === "projects" && <Projects projectSites={projectSites} setProjectSites={setProjectSites} inventoryItems={inventoryItems} onInventoryPull={pullFromInventory} />}
        {view === "reports" && <Reports inventoryItems={inventoryItems} deviceRecipes={deviceRecipes} inventoryValue={inventoryValue} openPoValue={openPoValue} inventoryMovements={inventoryMovements} buildTransactions={buildTransactions} projectAllocations={projectAllocations} />}
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
    reports: "Reports",
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
}: {
  roleMode: RoleMode;
  projectSites: ProjectSite[];
  lowStock: Part[];
  inventoryValue: number;
  openPoValue: number;
  buildTransactions: BuildTransaction[];
  inventoryMovements: InventoryMovement[];
}) {
  const importedLines = purchaseOrders.reduce((sum, order) => sum + order.lines.length, 0);
  const heldOrders = purchaseOrders.filter((order) => order.status === "On Hold");
  const plannedBuilds = buildTransactions.filter((build) => build.status === "planned");
  const recentReceipts = inventoryMovements.filter((movement) => movement.type === "receive").slice(0, 3);
  const recentTransfers = inventoryMovements.filter((movement) => movement.type === "transfer").slice(0, 3);
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
        { label: "Orders needing follow-up", value: String(heldOrders.length), note: heldOrders[0]?.paymentNote ?? "No held orders" },
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
        { label: "Purchasing exposure", value: money(openPoValue), note: "Recent captured order spend" },
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

function Purchasing({ projectSites }: { projectSites: ProjectSite[] }) {
  const [selectedProject, setSelectedProject] = useState("Straud Medical");
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const totalSpend = purchaseOrders.reduce((sum, order) => sum + order.total, 0);
  const totalTax = purchaseOrders.reduce((sum, order) => sum + order.tax, 0);
  const openOrders = purchaseOrders.filter((order) => order.status !== "Imported").length;
  const projectSpend = Object.entries(sumBy(purchaseOrders, (order) => order.projectRef)).sort((a, b) => b[1] - a[1]);
  const documentProjects = Array.from(new Set([...purchaseOrders.map((order) => order.projectRef), ...projectSites.map((project) => project.name)]));

  function handleDocumentSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const newDocs = files.map((file, index) => ({
      id: Date.now() + index,
      name: file.name,
      project: selectedProject,
      size: file.size,
      status: "Ready to review" as const,
    }));
    setUploadedDocs((current) => [...newDocs, ...current]);
    event.target.value = "";
  }

  return (
    <div className="content-grid purchasing-layout">
      <section className="metric-grid">
        <Metric icon={<ShoppingCart size={20} />} label="Recent Orders" value={String(purchaseOrders.length)} />
        <Metric icon={<DollarSign size={20} />} label="Captured Spend" value={money(totalSpend)} />
        <Metric icon={<FileText size={20} />} label="Sales Tax" value={money(totalTax)} />
        <Metric icon={<ClipboardList size={20} />} label="Open Follow-ups" value={String(openOrders)} />
      </section>

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
          {(uploadedDocs.length ? uploadedDocs : purchaseOrders.slice(0, 3).map((order, index) => ({
            id: index,
            name: order.sourceFile,
            project: order.projectRef,
            size: 0,
            status: "Ready to review" as const,
          }))).map((doc) => (
            <div className="document-row" key={`${doc.id}-${doc.name}`}>
              <div>
                <strong>{doc.name}</strong>
                <span>{doc.project}{doc.size ? ` - ${formatBytes(doc.size)}` : " - imported sample"}</span>
              </div>
              <span className="status ok">{doc.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <PanelHeader title="Imported Purchase Queue" label="Recent PDFs organized by vendor, project reference, and status" />
        <table>
          <thead>
            <tr><th>Order</th><th>Vendor</th><th>Project Ref</th><th>Status</th><th>Lines</th><th>Total</th></tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr key={po.number}>
                <td><strong>{po.number}</strong><small>{po.date}</small></td>
                <td>{po.vendor}</td>
                <td>{po.projectRef}</td>
                <td><span className={`status ${po.status === "On Hold" ? "warn" : po.status === "Imported" ? "ok" : ""}`}>{po.status}</span></td>
                <td>{po.lines.reduce((sum, line) => sum + line.qty, 0)} units <small>{po.sourceFile}</small></td>
                <td>{moneyExact(po.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <PanelHeader title="Spend By Project" label="PDF PO/ref fields" />
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
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Import Notes" label="What the PDFs told us" />
        <div className="note-list">
          <p>NeweggBusiness orders are tied to Straud Medical and include server compute, storage, GPU, power, and rack chassis hardware.</p>
          <p>Amazon orders are tied to Newport News and Newport News 37th St. with field enclosures, networking, rack, UPS, and hardware supplies.</p>
          <p>One NeweggBusiness order is on hold, so it is flagged for follow-up before inventory receiving.</p>
        </div>
      </section>

      <section className="panel full">
        <PanelHeader title="Order Line Items" label="Grouped from the attached order PDFs" />
        <div className="order-grid">
          {purchaseOrders.map((order) => (
            <article className="order-card" key={order.number}>
              <div className="order-card-header">
                <div>
                  <h3>{order.vendor}</h3>
                  <p>{order.number} - {order.projectRef}</p>
                </div>
                <span className={`status ${order.status === "On Hold" ? "warn" : order.status === "Imported" ? "ok" : ""}`}>{order.status}</span>
              </div>
              <div className="order-meta">
                <span>{order.date}</span>
                <span>{order.shipTo}</span>
                <span>{order.paymentNote}</span>
              </div>
              <div className="line-list">
                {order.lines.map((line) => (
                  <div className="line-item" key={`${order.number}-${line.name}`}>
                    <div>
                      <strong>{line.name}</strong>
                      <span>{line.category} - Qty {line.qty} at {moneyExact(line.unitCost)}</span>
                    </div>
                    <b>{moneyExact(lineTotal(line))}</b>
                  </div>
                ))}
              </div>
              <div className="order-totals">
                <span>Subtotal {moneyExact(order.subtotal)}</span>
                <span>Tax {moneyExact(order.tax)}</span>
                <strong>{moneyExact(order.total)}</strong>
              </div>
            </article>
          ))}
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
  const [inventoryTab, setInventoryTab] = useState<"parts" | "finished">("parts");
  const [filters, setFilters] = useState({ ref: "", part: "", category: "All", manufacturer: "", status: "All" });
  const [skuScan, setSkuScan] = useState("");
  const [scanStatus, setScanStatus] = useState("Scan or enter a SKU to pull up the item.");
  const [buildDraft, setBuildDraft] = useState({ recipeName: buildRecipes[0].name, qty: 1 });
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

  function requestBuild() {
    if (selectedBuildRecipe.retired || buildHasShortage || buildComponentRows.length === 0) {
      return;
    }

    setShowBuildConfirm(true);
  }

  function planBuild() {
    if (selectedBuildRecipe.retired || buildComponentRows.length === 0) {
      return;
    }

    onPlanBuild(selectedBuildRecipe, Math.max(1, Math.round(Number(buildDraft.qty) || 1)));
  }

  function confirmBuild() {
    onBuildInventoryUnit(selectedBuildRecipe, Math.max(1, Math.round(Number(buildDraft.qty) || 1)));
    setShowBuildConfirm(false);
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
      <section className="panel wide">
        <div className="panel-title-row">
          <div>
            <h2>Parts Inventory</h2>
            <p>{inventoryTab === "finished" ? "Finished manufactured equipment ready for projects" : "Purchasing parts, components, and field hardware"}</p>
          </div>
          <div className="action-row">
            <button className="secondary-action" type="button" onClick={() => openReceiveModal()}><Truck size={16} /> Receive Stock</button>
            <button className="secondary-action" type="button" onClick={() => openAdjustModal()}><ClipboardList size={16} /> Adjust Count</button>
            <button className="primary-action" type="button" onClick={openAddItemModal}><Plus size={17} /> Add New Item</button>
          </div>
        </div>
        <div className={`role-workbench ${roleMode}`}>
          <div>
            <strong>{roleCopy[roleMode].title}</strong>
            <span>{roleCopy[roleMode].body}</span>
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
            <button className="primary-action" type="button" onClick={() => setShowDeviceModal(true)}><Plus size={15} /> Open Equipment Builder</button>
          </div>
        </div>
        <div className="build-planner">
          <label>Equipment type<select value={buildDraft.recipeName} onChange={(event) => selectBuildRecipe(event.target.value)}>{equipmentOptions.map((recipe) => <option key={recipe.name} value={recipe.name}>{recipe.outputName}{recipe.retired ? " (Retired)" : ""}</option>)}<option value="__create_new_device">Create new device</option></select></label>
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
          <button className="primary-action" type="button" onClick={requestBuild} disabled={selectedBuildRecipe.retired || buildHasShortage || buildComponentRows.length === 0}>Review &amp; Build Now</button>
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
        <PanelHeader title="Inventory Movement Ledger" label="Receive, transfer, build, adjust, retire, undo" />
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
              <label>Title of Device<select value={buildDraft.recipeName} onChange={(event) => selectBuildRecipe(event.target.value)}>{equipmentOptions.map((recipe) => <option key={recipe.name} value={recipe.name}>{recipe.outputName}{recipe.retired ? " (Retired)" : ""}</option>)}<option value="__create_new_device">Create new device</option></select></label>
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
              <button className="primary-action" type="button" onClick={requestBuild} disabled={selectedBuildRecipe.retired || buildHasShortage || buildComponentRows.length === 0}>Review &amp; Build Equipment</button>
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
            <div className="build-confirm-list">
              {buildComponentRows.map((component) => (
                <div key={component.itemName}>
                  <span>{component.part?.ref ?? "No SKU"} - {component.itemName}</span>
                  <b>{component.required} used</b>
                </div>
              ))}
            </div>
            <div className="source-file"><ShoppingCart size={16} /><span>This will post a build transaction. Use Build History to undo it if the build was entered by mistake.</span></div>
            <div className="modal-actions">
              <button className="secondary-action" type="button" onClick={() => setShowBuildConfirm(false)}>Cancel</button>
              <button className="primary-action" type="button" onClick={confirmBuild}>Confirm Build</button>
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
                  <p>Tags control where this item appears inside Equipment Builder.</p>
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

function Projects({ projectSites, setProjectSites, inventoryItems, onInventoryPull }: { projectSites: ProjectSite[]; setProjectSites: Dispatch<SetStateAction<ProjectSite[]>>; inventoryItems: Part[]; onInventoryPull: (itemName: string, qty: number) => void }) {
  const initialProjectSlug = window.location.hash.startsWith("#projects/") ? window.location.hash.split("/")[1] : "";
  const initialProject = projectSites.find((project) => projectSlug(project.name) === initialProjectSlug);
  const [selectedProjectName, setSelectedProjectName] = useState(initialProject?.name ?? projects[0].name);
  const [projectMode, setProjectMode] = useState<"list" | "detail">(initialProject ? "detail" : "list");
  const [actionStatus, setActionStatus] = useState("Select a project, add a blank project, or build one from a sales quote.");
  const [isExtractingQuote, setIsExtractingQuote] = useState(false);
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

  function addBomLine() {
    const item = bomDraft.item.trim();
    const qty = Math.max(1, Math.round(Number(bomDraft.qty) || 1));
    if (!item) {
      setActionStatus("Add a material item before saving the BOM line.");
      return;
    }

    const pullingFromInventory = bomDraft.action === "pull" && selectedInventoryItem && selectedInventoryItem.stock >= qty;
    const line: BomLine = {
      item,
      qty,
      status: pullingFromInventory ? "From Inventory" : "Need Quote",
      requestSpeed: bomDraft.requestSpeed,
      notes: bomDraft.notes || (pullingFromInventory ? `Pulled from inventory. ${selectedInventoryItem.stock - qty} remaining.` : "Requested for Purchasing to order."),
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
      onInventoryPull(item, qty);
      setActionStatus(`${qty} ${item} added to ${selectedProject.ref} and pulled from inventory.`);
    } else if (bomDraft.action === "pull" && selectedInventoryItem) {
      setActionStatus(`${item} was added as Need Quote because only ${selectedInventoryItem.stock} are available in inventory.`);
    } else {
      setActionStatus(`${qty} ${item} added to ${selectedProject.ref} as a purchasing request.`);
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
        <section className="panel wide">
          <div className="action-header">
            <PanelHeader title="Projects" label="Project list, completion, and PM handoff status" />
            <div className="action-row">
              <button className="primary-action" type="button" onClick={addDraftProject}><Plus size={17} /> Add New Project</button>
            </div>
          </div>
          <div className="action-status">{actionStatus}</div>
        </section>

        <section className="metric-grid">
          <Metric icon={<ClipboardList size={20} />} label="Projects" value={String(projectSites.length)} />
          <Metric icon={<DollarSign size={20} />} label="Allocated Value" value={money(totalProjectValue)} />
          <Metric icon={<ShoppingCart size={20} />} label="In Purchasing" value={String(purchasingProjects)} />
          <Metric icon={<FileText size={20} />} label="Draft / Planning" value={String(draftProjects)} />
        </section>

        <section className="panel full">
          <PanelHeader title="Project List" label="Open a project to edit site info, SOW, and BOM" />
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
      <section className="panel wide">
        <div className="action-header">
          <PanelHeader title={selectedProject.name} label="Project workspace: site information, SOW, and BOM" />
          <div className="action-row">
            <button className="secondary-action" type="button" onClick={backToProjectList}>Back to Projects</button>
          </div>
        </div>
        <div className="action-status">{actionStatus}</div>
      </section>

      <section className="panel full">
        <PanelHeader title="Build Sales BOM and Scope" label="Upload a sales quote PDF to fill this project" />
        <label className={`sales-dropzone ${isExtractingQuote ? "is-working" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleSalesQuoteDrop}>
          <Upload size={26} />
          <strong>{isExtractingQuote ? "Reading sales quote..." : "Drag sales quote PDF here"}</strong>
          <span>{isExtractingQuote ? "Extracting project details, SOW sections, totals, and BOM lines." : "or choose a file to extract it into Project Details, SOW, and BOM."}</span>
          <input type="file" accept=".pdf" onChange={handleSalesQuoteSelect} disabled={isExtractingQuote} />
        </label>
        {selectedProject.salesQuoteFile && <div className="source-file"><FileText size={16} /><span>{selectedProject.salesQuoteFile}</span></div>}
      </section>

      <section className="panel full">
        <div className="panel-title-row">
          <div>
            <h2>Project Details</h2>
            <p>Editable site intake for this parking garage or lot</p>
          </div>
          <div className="locked-ref">
            <span>Internal project ref</span>
            <strong>{selectedProject.ref}</strong>
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
          <button className="primary-action" type="button" onClick={openAddBomModal}><Plus size={17} /> Add Material</button>
        </div>
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
                  <span><strong>Request to order</strong><small>Send this line to Purchasing as Need Quote</small></span>
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
}: {
  inventoryItems: Part[];
  deviceRecipes: BuildRecipe[];
  inventoryValue: number;
  openPoValue: number;
  inventoryMovements: InventoryMovement[];
  buildTransactions: BuildTransaction[];
  projectAllocations: ProjectAllocationHistory[];
}) {
  const vendorSpend = Object.entries(sumBy(purchaseOrders, (order) => order.vendor)).sort((a, b) => b[1] - a[1]);
  const projectSpend = Object.entries(sumBy(purchaseOrders, (order) => order.projectRef)).sort((a, b) => b[1] - a[1]);
  const categorySpend = purchaseOrders
    .flatMap((order) => order.lines)
    .reduce<Record<PurchaseLine["category"], number>>((totals, line) => {
      totals[line.category] = (totals[line.category] ?? 0) + lineTotal(line);
      return totals;
    }, {} as Record<PurchaseLine["category"], number>);
  const categoryRows = Object.entries(categorySpend).sort((a, b) => b[1] - a[1]);
  const largestCategory = Math.max(...categoryRows.map(([, total]) => total));
  const costHistoryRows = inventoryItems
    .map((part) => ({ part, trend: priceTrend(part) }))
    .filter((row): row is { part: Part; trend: NonNullable<ReturnType<typeof priceTrend>> } => Boolean(row.trend))
    .sort((a, b) => Math.abs(b.trend.change) - Math.abs(a.trend.change))
    .slice(0, 8);
  const sourceRows = inventoryItems.filter((part) => (part.purchaseUrls ?? []).length > 0).slice(0, 8);
  const reorderRows = inventoryItems.filter((part) => !part.retired && part.stock <= part.reorderPoint).sort((a, b) => a.stock - b.stock).slice(0, 12);
  const plannedBuildShortages = buildTransactions
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
  const [reportTab, setReportTab] = useState<"purchasing" | "inventory" | "manufacturing" | "projects">("purchasing");

  return (
    <div className="content-grid">
      <section className="panel wide">
        <div className="panel-title-row">
          <div>
            <h2>Reports</h2>
            <p>Purchasing, inventory, manufacturing, and project movement views.</p>
          </div>
        </div>
        <div className="segmented-tabs report-tabs">
          <button className={reportTab === "purchasing" ? "active" : ""} type="button" onClick={() => setReportTab("purchasing")}>Purchasing</button>
          <button className={reportTab === "inventory" ? "active" : ""} type="button" onClick={() => setReportTab("inventory")}>Inventory</button>
          <button className={reportTab === "manufacturing" ? "active" : ""} type="button" onClick={() => setReportTab("manufacturing")}>Manufacturing</button>
          <button className={reportTab === "projects" ? "active" : ""} type="button" onClick={() => setReportTab("projects")}>Projects</button>
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
          <p className="muted">Current demo inventory value plus recent order PDFs now captured in Purchasing.</p>
        </section>
      </>}
      {reportTab === "manufacturing" && <section className="panel wide">
        <PanelHeader title="Manufacturing History" label="Recent build transactions and ledger count" />
        <div className="snapshot-grid">
          <Metric icon={<Building2 size={20} />} label="Build Transactions" value={String(buildTransactions.length)} />
          <Metric icon={<ClipboardList size={20} />} label="Ledger Entries" value={String(inventoryMovements.length)} />
          <Metric icon={<Boxes size={20} />} label="Project Allocations" value={String(projectAllocations.length)} />
        </div>
        <div className="report-table compact-report-table">
          <div className="report-table-head"><span>Build</span><span>Qty</span><span>Stage</span><span>Status</span><span>Date</span></div>
          {buildTransactions.slice(0, 12).map((build) => (
            <div className="report-table-row" key={build.id}>
              <span><strong>{build.equipmentName}</strong><small>{build.buildNumber}</small></span>
              <span>{build.quantityBuilt}</span>
              <span>{build.stage ?? "complete"}</span>
              <span>{build.status}</span>
              <span>{new Date(build.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {buildTransactions.length === 0 && <div className="empty-compact-state">No manufacturing transactions recorded yet.</div>}
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
          {projectAllocations.slice(0, 14).map((allocation) => (
            <div className="report-table-row" key={allocation.id}>
              <span><strong>{allocation.projectName}</strong><small>{allocation.projectRef ?? "No PRJ"}</small></span>
              <span>{allocation.sku}<small>{allocation.itemName}</small></span>
              <span>{allocation.quantity}</span>
              <span>{allocation.action}</span>
              <span>{allocation.notes}<small>{new Date(allocation.createdAt).toLocaleString()}</small></span>
            </div>
          ))}
          {projectAllocations.length === 0 && <div className="empty-compact-state">No project allocations recorded yet.</div>}
        </div>
      </section>}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <section className="metric"><div>{icon}</div><span>{label}</span><strong>{value}</strong></section>;
}

function PanelHeader({ title, label }: { title: string; label: string }) {
  return <header className="panel-header"><div><h2>{title}</h2><p>{label}</p></div><FileText size={18} /></header>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

