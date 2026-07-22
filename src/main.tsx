import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardList,
  DollarSign,
  FileText,
  FolderOpen,
  LayoutDashboard,
  MapPin,
  Plus,
  Search,
  ShoppingCart,
  Truck,
  Upload,
  User,
} from "lucide-react";
import "./styles.css";

type View = "dashboard" | "purchasing" | "inventory" | "projects" | "reports";

type Part = {
  ref: string;
  name: string;
  description: string;
  manufacturer: string;
  category: "Base" | "Communications" | "Power" | "Lighting" | "Display";
  cost: number;
  stock: number;
  reorderPoint: number;
  vendorUrl?: string;
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
  { ref: "INV-0001", name: "FLI Edge VPI", description: "NanoPC T6 compute unit", manufacturer: "FriendlyElec", category: "Base", cost: 295, stock: 14, reorderPoint: 6 },
  { ref: "INV-0002", name: "Camera", description: "Camera, limit of 4. Prefer Axis", manufacturer: "Axis", category: "Base", cost: 500, stock: 18, reorderPoint: 8 },
  { ref: "INV-0003", name: "VPU case", description: "White steel junction box", manufacturer: "Joinfworld", category: "Base", cost: 255, stock: 9, reorderPoint: 4 },
  { ref: "INV-0004", name: "Cellular Data Connection", description: "Internal LTE in Nano", manufacturer: "SixFab / Telit", category: "Communications", cost: 65, stock: 7, reorderPoint: 5 },
  { ref: "INV-0005", name: "External Antenna", description: "External LTE antenna", manufacturer: "Bingfu / Dixingtech", category: "Communications", cost: 30, stock: 11, reorderPoint: 8 },
  { ref: "INV-0006", name: "External Cell Modem", description: "Industrial mobile router", manufacturer: "Ubiquiti", category: "Communications", cost: 225, stock: 5, reorderPoint: 3 },
  { ref: "INV-0007", name: "Network Switch", description: "Industrial PoE network switch", manufacturer: "LinoVision", category: "Communications", cost: 110, stock: 6, reorderPoint: 6 },
  { ref: "INV-0008", name: "Solar Panel", description: "12V 100W minimum, geography dependent", manufacturer: "Renogy", category: "Power", cost: 85, stock: 10, reorderPoint: 6 },
  { ref: "INV-0009", name: "Solar Charger", description: "MPPT 75 charger", manufacturer: "Victron Energy", category: "Power", cost: 75, stock: 8, reorderPoint: 5 },
  { ref: "INV-0010", name: "Solar Panel Mount Hardware", description: "Panel mounting hardware", manufacturer: "Renogy", category: "Power", cost: 66, stock: 13, reorderPoint: 6 },
  { ref: "INV-0011", name: "Solar Panel to MPPT Connection Cable", description: "12/2 outdoor AWG connection cable", manufacturer: "Field supply", category: "Power", cost: 25, stock: 15, reorderPoint: 10 },
  { ref: "INV-0012", name: "Battery", description: "LiFEPO4 12VDC at 300Wh", manufacturer: "GreenOE", category: "Power", cost: 65, stock: 12, reorderPoint: 6 },
  { ref: "INV-0013", name: "Smart Shunt", description: "300A shunt", manufacturer: "Victron Energy", category: "Power", cost: 85, stock: 6, reorderPoint: 6 },
  { ref: "INV-0014", name: "Smart Shunt Energy Cable", description: "VE.Direct to USB interface", manufacturer: "Victron Energy", category: "Power", cost: 35, stock: 10, reorderPoint: 7 },
  { ref: "INV-0015", name: "AC Charger", description: "AC charging adapter", manufacturer: "Amazon", category: "Power", cost: 25, stock: 16, reorderPoint: 8 },
  { ref: "INV-0016", name: "Power Junction Box", description: "Field wiring enclosure", manufacturer: "Field supply", category: "Power", cost: 45, stock: 9, reorderPoint: 5 },
  { ref: "INV-0017", name: "LED Light", description: "Optional additional lighting", manufacturer: "Amazon", category: "Lighting", cost: 145, stock: 4, reorderPoint: 3 },
  { ref: "INV-0018", name: "Pole for LED Light", description: "16ft pole for LED light", manufacturer: "Field supply", category: "Lighting", cost: 175, stock: 2, reorderPoint: 2 },
  { ref: "INV-0019", name: "32in Display", description: "Screen technology TBD", manufacturer: "TBD", category: "Display", cost: 3000, stock: 1, reorderPoint: 1 },
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

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [inventoryItems, setInventoryItems] = useState(parts);
  const lowStock = inventoryItems.filter((part) => part.stock <= part.reorderPoint);
  const inventoryValue = inventoryItems.reduce((sum, part) => sum + part.stock * part.cost, 0);
  const openPoValue = purchaseOrders.reduce((sum, po) => sum + po.total, 0);

  function pullFromInventory(itemName: string, qty: number) {
    setInventoryItems((current) =>
      current.map((part) => (part.name === itemName ? { ...part, stock: Math.max(0, part.stock - qty) } : part)),
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
          <NavButton icon={<LayoutDashboard size={18} />} label="Dashboard" active={view === "dashboard"} onClick={() => setView("dashboard")} />
          <NavButton icon={<ShoppingCart size={18} />} label="Purchasing" active={view === "purchasing"} onClick={() => setView("purchasing")} />
          <NavButton icon={<Boxes size={18} />} label="Inventory" active={view === "inventory"} onClick={() => setView("inventory")} />
          <NavButton icon={<ClipboardList size={18} />} label="Projects" active={view === "projects"} onClick={() => setView("projects")} />
          <NavButton icon={<BarChart3 size={18} />} label="Reports" active={view === "reports"} onClick={() => setView("reports")} />
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{pageTitle(view)}</h1>
            <p>Purchasing, inventory, project transfers, and reports for field packages.</p>
          </div>
          <div className="search-box">
            <Search size={16} />
            <span>Search parts, POs, projects</span>
          </div>
        </header>

        {view === "dashboard" && <Dashboard lowStock={lowStock} inventoryValue={inventoryValue} openPoValue={openPoValue} />}
        {view === "purchasing" && <Purchasing />}
        {view === "inventory" && <Inventory inventoryItems={inventoryItems} lowStock={lowStock} />}
        {view === "projects" && <Projects inventoryItems={inventoryItems} onInventoryPull={pullFromInventory} />}
        {view === "reports" && <Reports inventoryValue={inventoryValue} openPoValue={openPoValue} />}
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

function Dashboard({ lowStock, inventoryValue, openPoValue }: { lowStock: Part[]; inventoryValue: number; openPoValue: number }) {
  const importedLines = purchaseOrders.reduce((sum, order) => sum + order.lines.length, 0);
  const heldOrders = purchaseOrders.filter((order) => order.status === "On Hold");

  return (
    <div className="content-grid">
      <section className="metric-grid">
        <Metric icon={<Boxes size={20} />} label="Inventory Value" value={money(inventoryValue)} />
        <Metric icon={<ShoppingCart size={20} />} label="Recent Order Spend" value={money(openPoValue)} />
        <Metric icon={<FileText size={20} />} label="Imported Line Items" value={String(importedLines)} />
        <Metric icon={<Truck size={20} />} label="Active Projects" value={String(projects.length)} />
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
          {projects.map((project) => (
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

function Purchasing() {
  const [selectedProject, setSelectedProject] = useState("Straud Medical");
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const totalSpend = purchaseOrders.reduce((sum, order) => sum + order.total, 0);
  const totalTax = purchaseOrders.reduce((sum, order) => sum + order.tax, 0);
  const openOrders = purchaseOrders.filter((order) => order.status !== "Imported").length;
  const projectSpend = Object.entries(sumBy(purchaseOrders, (order) => order.projectRef)).sort((a, b) => b[1] - a[1]);
  const documentProjects = Array.from(new Set([...purchaseOrders.map((order) => order.projectRef), ...projects.map((project) => project.name)]));

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

function Inventory({ inventoryItems, lowStock }: { inventoryItems: Part[]; lowStock: Part[] }) {
  return (
    <div className="content-grid">
      <section className="panel wide">
        <PanelHeader title="Parts Inventory" label={`${inventoryItems.length} BOM items`} />
        <table>
          <thead>
            <tr><th>Ref</th><th>Part</th><th>Category</th><th>Manufacturer</th><th>Stock</th><th>Unit Cost</th><th>Status</th></tr>
          </thead>
          <tbody>
            {inventoryItems.map((part) => (
              <tr key={part.name}>
                <td><strong>{part.ref}</strong></td>
                <td><strong>{part.name}</strong><small>{part.description}</small></td>
                <td>{part.category}</td>
                <td>{part.manufacturer}</td>
                <td>{part.stock}</td>
                <td>{money(part.cost)}</td>
                <td>{part.stock <= part.reorderPoint ? <span className="status warn">Reorder</span> : <span className="status ok">Healthy</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <PanelHeader title="Reorder List" label="At or below point" />
        <div className="stack">
          {lowStock.map((part) => <div className="row-card" key={part.name}><strong>{part.name}</strong><b>{part.stock}/{part.reorderPoint}</b></div>)}
        </div>
      </section>
    </div>
  );
}

function Projects({ inventoryItems, onInventoryPull }: { inventoryItems: Part[]; onInventoryPull: (itemName: string, qty: number) => void }) {
  const [projectSites, setProjectSites] = useState(projects);
  const [selectedProjectName, setSelectedProjectName] = useState(projects[0].name);
  const [projectMode, setProjectMode] = useState<"list" | "detail">("list");
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
    window.history.replaceState({ ergonProjectMode: "list" }, "", "#projects");

    function handlePopState(event: PopStateEvent) {
      const state = event.state as { ergonProjectMode?: "list" | "detail"; projectName?: string } | null;

      if (state?.ergonProjectMode === "detail" && state.projectName) {
        setSelectedProjectName(state.projectName);
        setProjectMode("detail");
        setActionStatus(`${state.projectName} opened.`);
        return;
      }

      setProjectMode("list");
      setActionStatus("Back to project list.");
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function pushProjectHistory(mode: "list" | "detail", projectName?: string) {
    const slug = projectName ? projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "";
    window.history.pushState({ ergonProjectMode: mode, projectName }, "", mode === "detail" ? `#projects/${slug}` : "#projects");
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
    window.history.replaceState({ ergonProjectMode: "list" }, "", "#projects");
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

function Reports({ inventoryValue, openPoValue }: { inventoryValue: number; openPoValue: number }) {
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

  return (
    <div className="content-grid">
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
        <PanelHeader title="Ops Snapshot" label="Inventory plus captured purchasing" />
        <div className="report-total">{money(inventoryValue + openPoValue)}</div>
        <p className="muted">Current demo inventory value plus recent order PDFs now captured in Purchasing.</p>
      </section>
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
