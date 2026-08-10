// Vercel serverless function — builds an ATS-safe .docx from tailored resume content.
// No tables for layout, no text boxes, no images: just headings and paragraphs so
// applicant tracking systems parse it cleanly.
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require("docx");
const { verifyIdToken } = require("./_firebaseAdmin");

function textParagraph(text, opts = {}) {
  return new Paragraph({ spacing: { after: 100 }, ...opts, children: [new TextRun({ text, ...opts.run })] });
}

function bulletParagraph(text) {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 60 } });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    await verifyIdToken((req.body || {}).idToken);
  } catch (e) {
    return res.status(401).json({ error: "please sign in again" });
  }

  const { resume, contact } = req.body || {};
  if (!resume) return res.status(400).json({ error: "missing resume" });

  const children = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: contact?.name || "Puneet Gupta", bold: true, size: 32 })]
  }));
  if (resume.title_line) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: resume.title_line, size: 22, color: "444444" })]
    }));
  }
  const contactLine = [contact?.location, contact?.phone, contact?.email, contact?.linkedin].filter(Boolean).join(" · ");
  if (contactLine) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: contactLine, size: 18, color: "555555" })]
    }));
  }

  if (resume.summary) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 100, after: 80 }, children: [new TextRun("Summary")] }));
    children.push(textParagraph(resume.summary));
  }

  if (Array.isArray(resume.skills) && resume.skills.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 100, after: 80 }, children: [new TextRun("Skills")] }));
    children.push(textParagraph(resume.skills.join(" · ")));
  }

  if (Array.isArray(resume.bullet_sections) && resume.bullet_sections.length) {
    for (const section of resume.bullet_sections) {
      if (!section.header) continue;
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 140, after: 80 }, children: [new TextRun(section.header)] }));
      for (const b of section.bullets || []) children.push(bulletParagraph(b));
    }
  }

  if (Array.isArray(resume.experience) && resume.experience.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 140, after: 80 }, children: [new TextRun("Experience")] }));
    for (const job of resume.experience) {
      const titleLine = [job.title, job.company].filter(Boolean).join(" — ");
      const metaLine = [job.location, job.dates].filter(Boolean).join(" · ");
      children.push(new Paragraph({
        spacing: { before: 80, after: 20 },
        children: [new TextRun({ text: titleLine, bold: true })]
      }));
      if (metaLine) children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: metaLine, italics: true, size: 18, color: "555555" })] }));
      for (const b of job.bullets || []) children.push(bulletParagraph(b));
    }
  }

  if (Array.isArray(resume.projects) && resume.projects.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 140, after: 80 }, children: [new TextRun("Projects")] }));
    for (const p of resume.projects) {
      children.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: p.name, bold: true })] }));
      if (p.description) children.push(textParagraph(p.description));
    }
  }

  if (Array.isArray(resume.education) && resume.education.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 140, after: 80 }, children: [new TextRun("Education")] }));
    for (const e of resume.education) {
      const line = [e.degree, e.school, e.dates].filter(Boolean).join(" — ");
      children.push(textParagraph(line));
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }]
  });

  try {
    const buffer = await Packer.toBuffer(doc);
    const company = (req.body.fileNameHint || "resume").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${company}-resume.docx"`);
    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({ error: "docx build failed", detail: String(err) });
  }
};
