const fs = require('fs');
const path = require('path');

const DEFAULT_JOINER = '\n\n---\n\n';
const DEFAULT_MAX_PROMPT_CHARS = Number(process.env.MARKET_HUB_MAX_PROMPT_CHARS || 42000);

const C = {
  feishu: '\u98de\u4e66',
  referenceNote: '\u53c2\u8003\u7b14\u8bb0',
  languagePreference: '\u8bed\u8a00\u504f\u597d',
  title: '\u6807\u9898',
  review: '\u590d\u76d8',
  currentTask: '\u5f53\u524d\u4efb\u52a1',
  thisTask: '\u672c\u6b21\u4efb\u52a1',
  material: '\u5b9a\u5411\u7d20\u6750',
  sellingPoint: '\u4e3b\u63a8\u5356\u70b9',
  hardConstraints: '\u751f\u6210\u786c\u7ea6\u675f',
  brand: '\u54c1\u724c',
  product: '\u4ea7\u54c1',
  writingRules: '\u64b0\u5199\u89c4\u8303',
  outputFormat: '\u8f93\u51fa\u683c\u5f0f',
  template: '\u6a21\u677f',
  example: '\u793a\u4f8b',
  sampleText: '\u8303\u6587',
  framework: '\u6846\u67b6',
  imitation: '\u4eff\u5199',
  sourceMaster: '\u53c2\u8003\u6bcd\u672c',
  decisionPath: '\u7528\u6237\u51b3\u7b56\u8def\u5f84',
  searchTerm: '\u641c\u7d22\u8bcd',
  topicSignal: '\u9009\u9898\u4fe1\u53f7',
  naturalness: '\u81ea\u7136\u5ea6',
  platformExpression: '\u5e73\u53f0\u8868\u8fbe',
  frameworkBase: '\u6846\u67b6\u57fa\u7840',
};

function asText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function hasAny(text, fragments) {
  return fragments.some(fragment => text.includes(fragment));
}

function inferSource(module) {
  const name = String(module.name || '');
  const key = String(module.key || '');
  if (module.source) return module.source;
  if (hasAny(name, [C.feishu, C.referenceNote, C.languagePreference, C.title, C.review])) return 'feishu';
  if (hasAny(name, [C.currentTask, C.thisTask, C.material, C.sellingPoint, C.hardConstraints])) return 'request';
  if (key || hasAny(name, [C.brand, C.product, C.writingRules, C.outputFormat])) return 'local-file';
  if (hasAny(name, [C.template, C.example, C.sampleText, C.framework])) return 'template';
  return 'system';
}

function inferPriority(module) {
  const name = String(module.name || '');
  const key = String(module.key || '');
  if (Number.isFinite(module.priority)) return module.priority;
  if (key.startsWith('output') || hasAny(name, [C.outputFormat, C.currentTask, C.thisTask, C.hardConstraints])) return 100;
  if (hasAny(name, [C.imitation, C.sourceMaster])) return 96;
  if (hasAny(name, [C.decisionPath, C.searchTerm, C.topicSignal])) return 92;
  if (key === 'brand' || key === 'product' || hasAny(name, [C.brand, C.product, C.sellingPoint, C.material])) return 86;
  if (key === 'writing' || hasAny(name, [C.writingRules, C.naturalness])) return 82;
  if (hasAny(name, [C.template, C.example, C.framework])) return 72;
  if (hasAny(name, [C.feishu, C.referenceNote, C.languagePreference, C.title, C.review])) return 58;
  return 70;
}

function inferMaxChars(module) {
  const name = String(module.name || '');
  const key = String(module.key || '');
  if (Number.isFinite(module.maxChars)) return module.maxChars;
  if (hasAny(name, [C.languagePreference])) return 3600;
  if (hasAny(name, [C.feishu, C.referenceNote, C.platformExpression])) return 7200;
  if (hasAny(name, [C.title])) return 2600;
  if (hasAny(name, [C.imitation, C.sourceMaster])) return 9000;
  if (hasAny(name, [C.example, C.sampleText, C.frameworkBase])) return 5200;
  if (key === 'brand' || hasAny(name, [C.brand])) return 3600;
  if (key === 'product' || hasAny(name, [C.product])) return 2800;
  if (key === 'writing' || hasAny(name, [C.writingRules])) return 6500;
  if (key && key.startsWith('output') || hasAny(name, [C.outputFormat])) return 3600;
  return null;
}

function truncateMiddle(text, maxChars) {
  const value = asText(text);
  if (!Number.isFinite(maxChars) || maxChars <= 0 || value.length <= maxChars) return value;
  if (maxChars < 200) return value.slice(0, maxChars);
  const head = Math.floor(maxChars * 0.72);
  const tail = Math.max(80, maxChars - head - 80);
  return [
    value.slice(0, head).trimEnd(),
    `\n\n[context-harness: trimmed ${value.length - maxChars} chars]\n\n`,
    value.slice(-tail).trimStart(),
  ].join('');
}

function normalizeModules(modules = [], options = {}) {
  const applyDefaultCaps = options.applyDefaultCaps !== false;
  return modules
    .filter(Boolean)
    .map((module, index) => {
      const originalContent = asText(module.content);
      const maxChars = applyDefaultCaps ? inferMaxChars(module) : module.maxChars;
      const content = maxChars ? truncateMiddle(originalContent, maxChars) : originalContent;
      return {
        ...module,
        index,
        source: inferSource(module),
        priority: inferPriority(module),
        originalChars: originalContent.length,
        chars: content.length,
        trimmed: content.length < originalContent.length,
        content,
      };
    })
    .filter(module => module.content);
}

function shrinkToBudget(modules, maxPromptChars, joiner = DEFAULT_JOINER) {
  let total = modules.reduce((sum, module) => sum + module.content.length, 0) + Math.max(0, modules.length - 1) * joiner.length;
  if (!Number.isFinite(maxPromptChars) || total <= maxPromptChars) return modules;

  const byTrimPriority = [...modules].sort((a, b) => a.priority - b.priority || b.content.length - a.content.length);
  for (const module of byTrimPriority) {
    if (total <= maxPromptChars) break;
    if (module.priority >= 90 || module.content.length < 900) continue;
    const target = Math.max(700, module.content.length - (total - maxPromptChars));
    const next = truncateMiddle(module.content, target);
    total -= (module.content.length - next.length);
    module.content = next;
    module.chars = next.length;
    module.trimmed = true;
    module.budgetTrimmed = true;
  }
  return modules;
}

function assemblePrompt(modules = [], options = {}) {
  const joiner = options.joiner || DEFAULT_JOINER;
  const maxPromptChars = Number(options.maxPromptChars || DEFAULT_MAX_PROMPT_CHARS);
  const normalized = normalizeModules(modules, options);
  shrinkToBudget(normalized, maxPromptChars, joiner);
  return {
    prompt: normalized.map(module => module.content).join(joiner),
    modules: normalized,
    stats: summarizeModules(normalized),
  };
}

function summarizeModules(modules = []) {
  const normalized = modules.map(module => ({
    name: module.name,
    key: module.key || undefined,
    source: module.source || inferSource(module),
    priority: Number.isFinite(module.priority) ? module.priority : inferPriority(module),
    chars: Number(module.chars || asText(module.content).length || 0),
    originalChars: Number(module.originalChars || asText(module.content).length || 0),
    trimmed: !!module.trimmed,
  }));
  return {
    totalChars: normalized.reduce((sum, module) => sum + module.chars, 0),
    moduleCount: normalized.length,
    bySource: normalized.reduce((acc, module) => {
      acc[module.source] = (acc[module.source] || 0) + module.chars;
      return acc;
    }, {}),
    modules: normalized,
  };
}

function writePromptRunSnapshot(filePath, snapshot) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ...snapshot,
  });
  fs.appendFileSync(filePath, line + '\n', 'utf8');
}

module.exports = {
  assemblePrompt,
  normalizeModules,
  summarizeModules,
  writePromptRunSnapshot,
};
