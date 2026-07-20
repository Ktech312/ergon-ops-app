import { readFile } from "node:fs/promises";
import formidable from "formidable";
import { PDFParse } from "pdf-parse";

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_PREVIEW_LENGTH = 1200;

function firstMatch(text, patterns, fallback = "") {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return clean(match[1]);
    }
  }

  return fallback;
}

function clean(value) {
  return value.replace(/\s+/g, " ").trim();
}

function preparedFor(text, fallback) {
  const lines = text.split("\n").map((line) => clean(line)).filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toLowerCase() === "prepared for") {
      const candidate = lines[index + 1];
      if (candidate && !candidate.toLowerCase().includes("prepared by")) {
        return candidate;
      }
    }
  }

  const inline = text.match(/PREPARED FOR\s+([^\n]+?)(?:\s+PREPARED BY|\n|$)/i);
  const candidate = inline?.[1] ? clean(inline[1]) : "";

  return candidate && !candidate.toLowerCase().includes("prepared by") ? candidate : fallback;
}

function sectionBetween(text, startPattern, endPatterns) {
  const startMatch = text.match(startPattern);
  if (startMatch?.index === undefined) {
    return "";
  }

  const start = startMatch.index + startMatch[0].length;
  const rest = text.slice(start);
  const endIndexes = endPatterns
    .map((pattern) => {
      const match = rest.match(pattern);
      return match?.index ?? -1;
    })
    .filter((index) => index >= 0);
  const end = endIndexes.length ? Math.min(...endIndexes) : rest.length;

  return clean(rest.slice(0, end));
}

function quantityFor(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...text.matchAll(new RegExp(`${escaped}(?:\\s*\\([^)]*\\))?\\s+(\\d+)`, "gi"))];
  return matches.reduce((sum, match) => sum + Number(match[1]), 0);
}

function moneyValue(text, patterns) {
  const raw = firstMatch(text, patterns, "");
  if (!raw) {
    return 0;
  }

  return Number(raw.replace(/[$,]/g, ""));
}

function buildBom(text) {
  const lines = [
    ["EnSightful Edge Vision Processing Unit", "Edge compute/server hardware"],
    ["Network Equipment", "Client/network hardware scope called out in quote"],
    ["EnSight Eyes - Vehicle Counting Camera and Software", "Vehicle counting camera/software"],
    ["Dual Lens Camera for FLI Counting and Rear Plate LPR", "Counting plus rear plate LPR camera"],
    ["Full Matrix Display - 2ft H x 7ft W - 5mm", "Entrance/interior guidance display"],
    ["Full Matrix Display - 6 ft H X 4.5 ft W - 5mm", "Large guidance display"],
    ["Sign Mount Hardware", "Display mounting hardware"],
    ["EnSight - Sign Controller", "Controller for matrix sign messaging"],
    ["Project Management Hours", "Remote implementation service"],
    ["System Engineering and Drawing Hours", "Engineering and drawing support"],
  ];

  return lines
    .map(([item, notes]) => ({
      item,
      qty: quantityFor(text, item),
      status: "Need Quote",
      requestSpeed: "Standard",
      notes,
    }))
    .filter((line) => line.qty > 0);
}

export function extractQuoteData(text, sourceFile, projectRef = "") {
  const normalized = text.replace(/\r/g, "\n");
  const lower = normalized.toLowerCase();
  const isEmeraldQueen = lower.includes("emerald queen");
  const projectTitle = clean(normalized.split("\n").find((line) => line.trim().length > 8) ?? "New Sales Quote Project");
  const client = preparedFor(normalized, isEmeraldQueen ? "Emerald Queen Casino & Hotel" : "Client from sales quote");
  const hardwareTotal = moneyValue(normalized, [/System Hardware and Technology Investment Total\s+(\$[\d,]+\.\d{2})/i]);
  const sssaTotal = moneyValue(normalized, [/Annual Software and Support Services Agreement \(SSSA\) Total:\s+(\$[\d,]+\.\d{2})/i]);
  const bom = buildBom(normalized);
  const cameraQty = bom
    .filter((line) => line.item.toLowerCase().includes("camera"))
    .reduce((sum, line) => sum + line.qty, 0);
  const matrixSignQty = bom
    .filter((line) => line.item.toLowerCase().includes("matrix display"))
    .reduce((sum, line) => sum + line.qty, 0);

  const preparation = sectionBetween(normalized, /1\.\s*Preparation/i, [/2\.\s*Infrastructure/i, /--\s*\d+\s+of/i]);
  const infrastructure = sectionBetween(normalized, /2\.\s*Infrastructure/i, [/3\.\s*Installation/i, /--\s*\d+\s+of/i]);
  const installation = sectionBetween(normalized, /3\.\s*Installation/i, [/4\.\s*Commissioning/i, /--\s*\d+\s+of/i]);
  const commissioning = sectionBetween(normalized, /4\.\s*Commissioning/i, [/5\.\s*Fine Tuning/i, /--\s*\d+\s+of/i]);
  const fineTuning = sectionBetween(normalized, /5\.\s*Fine Tuning/i, [/Total Occupancy Guidance System/i, /--\s*\d+\s+of/i]);
  const assumptions = sectionBetween(normalized, /Assumptions:/i, [/Exclusions:/i, /Warranty/i]);
  const exclusions = sectionBetween(normalized, /Exclusions:/i, [/Warranty/i, /Payment Terms/i, /--\s*\d+\s+of/i]);

  const name = isEmeraldQueen ? "Emerald Queen Tacoma - New Garage" : projectTitle;
  const address = isEmeraldQueen ? "Tacoma, WA - new parking garage" : "Client location TBD";
  const summary = firstMatch(
    normalized,
    [/Executive Summary\s+([\s\S]*?)Project Plan And Performance/i, /Executive Summary\s+([\s\S]*?)Base Bid Included/i],
    `Sales quote uploaded from ${sourceFile}. Review extracted scope and BOM before purchasing.`,
  );

  return {
    confidence: isEmeraldQueen ? "high" : "draft",
    mode: "pdf-text-rules",
    project: {
      ref: projectRef,
      name,
      client,
      type: "Parking Garage",
      address,
      owner: "Projects / Implementation",
      status: "Planning",
      due: "TBD",
      package: isEmeraldQueen
        ? "Occupancy management, guidance signage, LPR, level counting, portal, and support services"
        : "Sales quote imported for PM review",
      cameras: cameraQty,
      allocated: hardwareTotal + sssaTotal,
      siteNotes: `Extracted from ${sourceFile}. ${cameraQty} camera-related units and ${matrixSignQty} matrix signs detected. Review all fields before creating purchase requests.`,
      salesQuoteFile: sourceFile,
      sow: {
        summary,
        preparation: preparation || "Review quote for preparation requirements.",
        infrastructure: infrastructure || "Review quote for power, network, conduit, and customer-provided infrastructure requirements.",
        installation: installation || "Review quote for install responsibilities and site coordination.",
        commissioning: commissioning || "Review quote for commissioning and software activation requirements.",
        fineTuning: fineTuning || "Review quote for tuning, go-live, and acceptance details.",
        assumptions: assumptions || "No assumptions were confidently extracted.",
        exclusions: exclusions || "No exclusions were confidently extracted.",
      },
      bom: bom.length
        ? bom
        : [
            { item: "Camera / Sensor Hardware", qty: 0, status: "Need Quote", requestSpeed: "Standard", notes: "Parser did not find a confident quantity." },
            { item: "Network / Power Infrastructure", qty: 0, status: "Need Quote", requestSpeed: "Standard", notes: "Review quote manually." },
          ],
    },
    extractedTextPreview: clean(normalized.slice(0, MAX_PREVIEW_LENGTH)),
  };
}

async function parseForm(req) {
  const form = formidable({
    keepExtensions: true,
    maxFileSize: 25 * 1024 * 1024,
    multiples: false,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ fields, files });
    });
  });
}

function single(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Use POST with a sales quote PDF." });
    return;
  }

  try {
    const { fields, files } = await parseForm(req);
    const upload = single(files.file);

    if (!upload?.filepath) {
      res.status(400).json({ error: "No PDF file was uploaded." });
      return;
    }

    const buffer = await readFile(upload.filepath);
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    await parser.destroy?.();

    const sourceFile = upload.originalFilename || "sales-quote.pdf";
    const projectRef = single(fields.projectRef) || "";
    const extraction = extractQuoteData(parsed.text, sourceFile, projectRef);

    res.status(200).json(extraction);
  } catch (error) {
    res.status(500).json({
      error: "Could not extract the sales quote PDF.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
