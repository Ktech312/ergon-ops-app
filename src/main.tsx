import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  DollarSign,
  FileText,
  LayoutDashboard,
  PackageCheck,
  Search,
  ShoppingCart,
  Truck,
} from "lucide-react";
import "./styles.css";

type View = "dashboard" | "purchasing" | "inventory" | "projects" | "reports";

type Part = {
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

const parts: Part[] = [
  { name: "FLI Edge VPI", description: "NanoPC T6 compute unit", manufacturer: "FriendlyElec", category: "Base", cost: 295, stock: 14, reorderPoint: 6 },
  { name: "Camera", description: "Camera, limit of 4. Prefer Axis", manufacturer: "Axis", category: "Base", cost: 500, stock: 18, reorderPoint: 8 },
  { name: "VPU case", description: "White steel junction box", manufacturer: "Joinfworld", category: "Base", cost: 255, stock: 9, reorderPoint: 4 },
  { name: "Cellular Data Connection", description: "Internal LTE in Nano", manufacturer: "SixFab / Telit", category: "Communications", cost: 65, stock: 7, reorderPoint: 5 },
  { name: "External Antenna", description: "External LTE antenna", manufacturer: "Bingfu / Dixingtech", category: "Communications", cost: 30, stock: 11, reorderPoint: 8 },
  { name: "External Cell Modem", description: "Industrial mobile router", manufacturer: "Ubiquiti", category: "Communications", cost: 225, stock: 5, reorderPoint: 3 },
  { name: "Network Switch", description: "Industrial PoE network switch", manufacturer: "LinoVision", category: "Communications", cost: 110, stock: 6, reorderPoint: 6 },
  { name: "Solar Panel", description: "12V 100W minimum, geography dependent", manufacturer: "Renogy", category: "Power", cost: 85, stock: 10, reorderPoint: 6 },
  { name: "Solar Charger", description: "MPPT 75 charger", manufacturer: "Victron Energy", category: "Power", cost: 75, stock: 8, reorderPoint: 5 },
  { name: "Solar Panel Mount Hardware", description: "Panel mounting hardware", manufacturer: "Renogy", category: "Power", cost: 66, stock: 13, reorderPoint: 6 },
  { name: "Solar Panel to MPPT Connection Cable", description: "12/2 outdoor AWG connection cable", manufacturer: "Field supply", category: "Power", cost: 25, stock: 15, reorderPoint: 10 },
  { name: "Battery", description: "LiFEPO4 12VDC at 300Wh", manufacturer: "GreenOE", category: "Power", cost: 65, stock: 12, reorderPoint: 6 },
  { name: "Smart Shunt", description: "300A shunt", manufacturer: "Victron Energy", category: "Power", cost: 85, stock: 6, reorderPoint: 6 },
  { name: "Smart Shunt Energy Cable", description: "VE.Direct to USB interface", manufacturer: "Victron Energy", category: "Power", cost: 35, stock: 10, reorderPoint: 7 },
  { name: "AC Charger", description: "AC charging adapter", manufacturer: "Amazon", category: "Power", cost: 25, stock: 16, reorderPoint: 8 },
  { name: "Power Junction Box", description: "Field wiring enclosure", manufacturer: "Field supply", category: "Power", cost: 45, stock: 9, reorderPoint: 5 },
  { name: "LED Light", description: "Optional additional lighting", manufacturer: "Amazon", category: "Lighting", cost: 145, stock: 4, reorderPoint: 3 },
  { name: "Pole for LED Light", description: "16ft pole for LED light", manufacturer: "Field supply", category: "Lighting", cost: 175, stock: 2, reorderPoint: 2 },
  { name: "32in Display", description: "Screen technology TBD", manufacturer: "TBD", category: "Display", cost: 3000, stock: 1, reorderPoint: 1 },
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

const purchaseOrders = [
  { number: "PO-1001", vendor: "FriendlyElec", items: "FLI Edge VPI x 6", total: 1770, status: "Ordered", due: "Jul 24" },
  { number: "PO-1002", vendor: "Victron Energy", items: "Shunts, chargers, cables", total: 1540, status: "Draft", due: "Jul 28" },
  { number: "PO-1003", vendor: "Renogy", items: "Solar kits", total: 1760, status: "Approval", due: "Aug 02" },
];

const projects = [
  { name: "Lakeside Gate", package: "Constant Power + WiFi", status: "Staging", cameras: 2, allocated: 1740, due: "Jul 30" },
  { name: "North Lot", package: "No Power + No WiFi", status: "Purchasing", cameras: 4, allocated: 3441, due: "Aug 09" },
  { name: "Warehouse East", package: "Intermittent Power + No WiFi", status: "Install Ready", cameras: 3, allocated: 2690, due: "Aug 15" },
];

function money(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function App() {
  const [view, setView] = useState<View>("dashboard");
  const lowStock = parts.filter((part) => part.stock <= part.reorderPoint);
  const inventoryValue = parts.reduce((sum, part) => sum + part.stock * part.cost, 0);
  const openPoValue = purchaseOrders.reduce((sum, po) => sum + po.total, 0);

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
        {view === "inventory" && <Inventory lowStock={lowStock} />}
        {view === "projects" && <Projects />}
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
  return (
    <div className="content-grid">
      <section className="metric-grid">
        <Metric icon={<Boxes size={20} />} label="Inventory Value" value={money(inventoryValue)} />
        <Metric icon={<ShoppingCart size={20} />} label="Open Purchasing" value={money(openPoValue)} />
        <Metric icon={<PackageCheck size={20} />} label="Low Stock Items" value={String(lowStock.length)} />
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
        <PanelHeader title="Needs Attention" label="Reorder watch" />
        <div className="stack">
          {lowStock.map((part) => (
            <div className="row-card" key={part.name}>
              <div>
                <strong>{part.name}</strong>
                <span>{part.category}</span>
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
  return (
    <section className="panel full">
      <PanelHeader title="Purchase Orders" label="Demo purchasing queue" />
      <table>
        <thead>
          <tr><th>PO</th><th>Vendor</th><th>Items</th><th>Status</th><th>Due</th><th>Total</th></tr>
        </thead>
        <tbody>
          {purchaseOrders.map((po) => (
            <tr key={po.number}>
              <td>{po.number}</td>
              <td>{po.vendor}</td>
              <td>{po.items}</td>
              <td><span className="status">{po.status}</span></td>
              <td>{po.due}</td>
              <td>{money(po.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Inventory({ lowStock }: { lowStock: Part[] }) {
  return (
    <div className="content-grid">
      <section className="panel wide">
        <PanelHeader title="Parts Inventory" label={`${parts.length} BOM items`} />
        <table>
          <thead>
            <tr><th>Part</th><th>Category</th><th>Manufacturer</th><th>Stock</th><th>Unit Cost</th><th>Status</th></tr>
          </thead>
          <tbody>
            {parts.map((part) => (
              <tr key={part.name}>
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

function Projects() {
  return (
    <section className="panel full">
      <PanelHeader title="Project Transfers" label="Inventory allocated by project" />
      <div className="project-grid">
        {projects.map((project) => (
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
  );
}

function Reports({ inventoryValue, openPoValue }: { inventoryValue: number; openPoValue: number }) {
  return (
    <div className="content-grid">
      <section className="panel">
        <PanelHeader title="Project Usage" label="Allocated materials" />
        <div className="stack">
          {projects.map((project) => <div className="row-card" key={project.name}><strong>{project.name}</strong><b>{money(project.allocated)}</b></div>)}
        </div>
      </section>
      <section className="panel">
        <PanelHeader title="Spend Snapshot" label="Current demo totals" />
        <div className="report-total">{money(inventoryValue + openPoValue)}</div>
        <p className="muted">Inventory value plus open purchase orders.</p>
      </section>
      <section className="panel wide">
        <PanelHeader title="Package Cost Comparison" label="Without cameras" />
        <div className="bar-list">
          {packageOptions.map((pkg) => (
            <div className="bar-row" key={pkg.name}>
              <span>{pkg.name}</span>
              <div><i style={{ width: `${(pkg.costWithoutCameras / 1441) * 100}%` }} /></div>
              <b>{money(pkg.costWithoutCameras)}</b>
            </div>
          ))}
        </div>
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
