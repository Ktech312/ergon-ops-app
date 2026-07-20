import { readFile } from "node:fs/promises";
import formidable from "formidable";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_PREVIEW_LENGTH = 1200;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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

function quantityFor(text, label, nextLabel = "") {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sameLineMatches = [...text.matchAll(new RegExp(`${escaped}(?:\\s*\\([^)]*\\))?\\s*(\\d+)`, "gi"))];
  const sameLineTotal = sameLineMatches.reduce((sum, match) => sum + Number(match[1]), 0);
  if (sameLineTotal > 0) {
    return sameLineTotal;
  }

  const start = text.indexOf(label);
  if (start < 0) {
    return 0;
  }

  const end = nextLabel ? text.indexOf(nextLabel, start + label.length) : -1;
  const section = text.slice(start + label.length, end > start ? end : start + label.length + 900);
  const standaloneNumbers = [...section.matchAll(/(?:^|\n)\s*(\d{1,4})\s*(?=\n|$)/g)].map((match) => Number(match[1]));

  return standaloneNumbers.at(-1) ?? 0;
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
    .map(([item, notes], index) => {
      const nextItem = lines[index + 1]?.[0] ?? "";

      return {
        item,
        qty: quantityFor(text, item, nextItem),
        status: "Need Quote",
        requestSpeed: "Standard",
        notes,
      };
    })
    .filter((line) => line.qty > 0);
}

export function extractQuoteData(text, sourceFile, projectRef = "") {
  const normalized = text.replace(/\r/g, "\n");
  const lower = normalized.toLowerCase();
  const isEmeraldQueen = lower.includes("emerald queen");
  const projectTitle = clean(normalized.split("\n").find((line) => line.trim().length > 8) ?? "New Sales Quote Project");
  const client = isEmeraldQueen ? "Emerald Queen Casino & Hotel" : preparedFor(normalized, "Client from sales quote");
  const hardwareTotal = moneyValue(normalized, [/System Hardware and Technology Investment Total\s+(\$[\d,]+\.\d{2})/i]);
  const sssaTotal = moneyValue(normalized, [/Annual Software and Support Services Agreement \(SSSA\) Total:\s*(\$[\d,]+\.\d{2})/i]);
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

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    confidence: { type: "string", enum: ["draft", "medium", "high"] },
    project: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        client: { type: "string" },
        type: { type: "string", enum: ["Parking Garage", "Surface Lot", "Campus Parking", "Mixed Parking"] },
        address: { type: "string" },
        owner: { type: "string" },
        status: { type: "string", enum: ["Draft", "Planning", "Purchasing", "Staging", "Install Ready"] },
        due: { type: "string" },
        package: { type: "string" },
        cameras: { type: "number" },
        allocated: { type: "number" },
        siteNotes: { type: "string" },
        sow: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            preparation: { type: "string" },
            infrastructure: { type: "string" },
            installation: { type: "string" },
            commissioning: { type: "string" },
            fineTuning: { type: "string" },
            assumptions: { type: "string" },
            exclusions: { type: "string" },
          },
          required: ["summary", "preparation", "infrastructure", "installation", "commissioning", "fineTuning", "assumptions", "exclusions"],
        },
        bom: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              item: { type: "string" },
              qty: { type: "number" },
              status: { type: "string", enum: ["Need Quote", "Not started", "Ordered", "Completed", "From Inventory", "Delivered to Office", "Delivered to Client"] },
              requestSpeed: { type: "string", enum: ["ASAP", "Standard", "Future"] },
              po: { type: "string" },
              notes: { type: "string" },
            },
            required: ["item", "qty", "status", "requestSpeed", "po", "notes"],
          },
        },
        reviewWarnings: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["name", "client", "type", "address", "owner", "status", "due", "package", "cameras", "allocated", "siteNotes", "sow", "bom", "reviewWarnings"],
    },
  },
  required: ["confidence", "project"],
};

function extractOutputText(responseJson) {
  if (responseJson.output_text) {
    return responseJson.output_text;
  }

  const message = responseJson.output?.find((item) => item.type === "message");
  const textPart = message?.content?.find((part) => part.type === "output_text");
  return textPart?.text || "";
}

async function extractQuoteDataWithAi(text, sourceFile, projectRef = "") {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "You extract parking garage and parking lot sales quote PDFs for an operations app. Return editable project details, scope of work, BOM lines, totals, assumptions, exclusions, and warnings. Do not invent quantities or costs; use reviewWarnings when uncertain.",
        },
        {
          role: "user",
          content: `Project ref: ${projectRef}\nSource file: ${sourceFile}\n\nExtract this quote text:\n${text.slice(0, 70000)}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "sales_quote_extraction",
          strict: true,
          schema: extractionSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI extraction failed with status ${response.status}: ${await response.text()}`);
  }

  const responseJson = await response.json();
  const outputText = extractOutputText(responseJson);
  const aiResult = JSON.parse(outputText);

  return {
    confidence: aiResult.confidence,
    mode: `openai:${OPENAI_MODEL}`,
    project: {
      ...aiResult.project,
      ref: projectRef,
      salesQuoteFile: sourceFile,
    },
    extractedTextPreview: clean(text.slice(0, MAX_PREVIEW_LENGTH)),
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

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
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
    if (String(req.headers["content-type"] || "").includes("application/json")) {
      const body = await readJsonBody(req);
      if (!body.text) {
        res.status(400).json({ error: "No extracted PDF text was provided." });
        return;
      }

      const extraction =
        (await extractQuoteDataWithAi(body.text, body.sourceFile || "sales-quote.pdf", body.projectRef || "")) ||
        extractQuoteData(body.text, body.sourceFile || "sales-quote.pdf", body.projectRef || "");
      res.status(200).json(extraction);
      return;
    }

    const { fields, files } = await parseForm(req);
    const upload = single(files.file);

    if (!upload?.filepath) {
      res.status(400).json({ error: "No PDF file was uploaded." });
      return;
    }

    const buffer = await readFile(upload.filepath);
    const parsed = await pdfParse(buffer);

    const sourceFile = upload.originalFilename || "sales-quote.pdf";
    const projectRef = single(fields.projectRef) || "";
    const extraction = (await extractQuoteDataWithAi(parsed.text, sourceFile, projectRef)) || extractQuoteData(parsed.text, sourceFile, projectRef);

    res.status(200).json(extraction);
  } catch (error) {
    res.status(500).json({
      error: "Could not extract the sales quote PDF.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
