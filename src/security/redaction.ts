import { SENSITIVE_KEY_RE, TEXT_KEYS, URL_KEYS, REDACTION_PATTERNS } from '../config/constants.js';

export function normalizeDigits(value: unknown): string {
  return String(value)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function luhnValid(value: unknown): boolean {
  const digits = normalizeDigits(value).replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactString(input: unknown, mode: string = 'sensitive'): string {
  if (mode === 'none') return String(input ?? '');
  let value = String(input ?? '');
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    value = value.replace(pattern, replacement);
  }
  value = value.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) =>
    luhnValid(match) ? '[REDACTED:CARD]' : match,
  );
  if (mode === 'all') {
    value = value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED:EMAIL]');
    value = value.replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[REDACTED:PHONE]');
  }
  return value;
}

export function redactUrl(raw: unknown, mode: string = 'sensitive'): unknown {
  if (raw == null) return raw;
  const string = String(raw);
  if (/^data:/i.test(string)) return '[data-url]';
  if (/^blob:/i.test(string)) return '[blob-url]';
  let url: URL;
  try {
    url = new URL(string);
  } catch {
    return redactString(string, mode);
  }
  for (const key of Array.from(url.searchParams.keys())) {
    if (SENSITIVE_KEY_RE.test(key)) {
      url.searchParams.set(key, '[REDACTED]');
    }
  }
  if (url.hash && /[?&](?:token|access_token|id_token|code|secret|key)=/i.test(url.hash)) {
    url.hash = '#[REDACTED]';
  }
  return redactString(url.toString(), mode);
}

export function redactValueForKey(
  key: unknown,
  value: unknown,
  mode: string = 'sensitive',
): unknown {
  if (value == null) return value;
  if (mode !== 'none' && SENSITIVE_KEY_RE.test(String(key))) {
    return '[REDACTED]';
  }
  return redactString(value, mode);
}

export function serializeRemoteObject(remote: any, mode: string): unknown {
  if (!remote) return null;
  if (remote.type === 'undefined') return 'undefined';
  if (remote.type === 'string') return redactString(remote.value ?? '', mode);
  if (remote.type === 'number' || remote.type === 'boolean') return remote.value;
  if (remote.type === 'bigint') return remote.unserializableValue ?? remote.description ?? null;
  if (remote.type === 'symbol') return remote.description ?? null;
  if (remote.type === 'function') return `[Function ${remote.description || 'anonymous'}]`;
  if (remote.subtype === 'null') return null;
  if (remote.subtype === 'error') {
    return redactString(remote.description || remote.className || 'Error', mode);
  }
  if (remote.value !== undefined) {
    return redactAny(remote.value, mode, 0);
  }
  if (remote.preview) {
    const preview: Record<string, unknown> = {};
    for (const property of (remote.preview.properties || []).slice(0, 20)) {
      preview[property.name] = redactValueForKey(
        property.name,
        property.value ?? property.type,
        mode,
      );
    }
    return {
      type: remote.className || remote.subtype || 'object',
      description: redactString(remote.description || '', mode),
      preview,
    };
  }
  return {
    type: remote.className || remote.subtype || 'object',
    description: redactString(remote.description || '', mode),
  };
}

export function redactAny(value: unknown, mode: string, depth: number): unknown {
  if (depth > 5) return '[MaxDepth]';
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value, mode);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'symbol') return String(value);
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => redactAny(item, mode, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).slice(0, 20)) {
      out[key] = SENSITIVE_KEY_RE.test(key)
        ? '[REDACTED]'
        : redactAny((value as Record<string, unknown>)[key], mode, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function redactStorageSection(section: any, mode: string): any {
  if (!section || typeof section !== 'object') return section;
  const out = { ...section };
  for (const store of ['localStorage', 'sessionStorage']) {
    if (out[store] && typeof out[store] === 'object') {
      const storeObj = { ...out[store] };
      if (Array.isArray(storeObj.entries)) {
        storeObj.entries = storeObj.entries.map((entry: any) => {
          if (!entry || typeof entry !== 'object') return entry;
          let value = entry.value;
          if (value !== undefined && value !== '[REDACTED]') {
            value = redactValueForKey(entry.key, value, mode);
          }
          return { ...entry, value };
        });
      }
      for (const [key, value] of Object.entries(storeObj)) {
        if (
          !['available', 'count', 'entries', 'truncated', 'error'].includes(key) &&
          typeof value === 'string'
        ) {
          if (value !== '[REDACTED]') {
            storeObj[key] = redactValueForKey(key, value, mode);
          }
        }
      }
      out[store] = storeObj;
    }
  }
  return out;
}

export function redactCookieSection(section: any, mode: string): any {
  if (!section || typeof section !== 'object') return section;
  const out = { ...section };
  if (Array.isArray(out.entries)) {
    out.entries = out.entries.map((entry: any) => {
      if (!entry || typeof entry !== 'object') return entry;
      let value = entry.value;
      if (value !== undefined) value = redactValueForKey(entry.name, value, mode);
      return { ...entry, value };
    });
  }
  return out;
}

export function redactReport(value: any, mode: string, parentKey: string | null = null): any {
  if (mode === 'none') return value;
  if (Array.isArray(value)) return value.map((item) => redactReport(item, mode, parentKey));
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'attributes' && item && typeof item === 'object' && !Array.isArray(item)) {
      const attrs: Record<string, unknown> = {};
      for (const [attrName, attrValue] of Object.entries(item as Record<string, unknown>)) {
        attrs[attrName] = redactValueForKey(attrName, String(attrValue), mode);
      }
      out[key] = attrs;
      continue;
    }
    if (key === 'storage' && item && typeof item === 'object') {
      out[key] = redactStorageSection(item, mode);
      continue;
    }
    if (key === 'cookies' && item && typeof item === 'object') {
      out[key] = redactCookieSection(item, mode);
      continue;
    }
    if (TEXT_KEYS.has(key) && typeof item === 'string') {
      out[key] = redactString(item, mode);
      continue;
    }
    if (URL_KEYS.has(key) && typeof item === 'string') {
      out[key] = redactUrl(item, mode);
      continue;
    }
    out[key] = redactReport(item, mode, key);
  }
  return out;
}
