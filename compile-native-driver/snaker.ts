function upperCaseWord(word: string): string {
  if (commonInitialisms.has(word.toUpperCase())) {
    return word.toLocaleUpperCase();
  } else {
    return word[0].toLocaleUpperCase() + word.slice(1);
  }
}

export function snakeToCamel(text: string): string {
  return text.split("-").map(upperCaseWord).join("");
}

export function snakeToCamelLower(text: string): string {
  return text.split("-").map((w, idx) => idx > 0 ? upperCaseWord(w) : w).join(
    "",
  );
}

// commonInitialisms, taken from
// https://github.com/golang/lint/blob/206c0f020eba0f7fbcfbc467a5eb808037df2ed6/lint.go#L731
export const commonInitialisms = new Set([
  "ACL",
  "API",
  "ASCII",
  "CPU",
  "CSS",
  "DNS",
  "EOF",
  "GUID",
  "HTML",
  "HTTP",
  "HTTPS",
  "ID",
  "IP",
  "JSON",
  "LHS",
  "OS",
  "QPS",
  "RAM",
  "RHS",
  "RPC",
  "SLA",
  "SMTP",
  "SQL",
  "SSH",
  "TCP",
  "TLS",
  "TTL",
  "UDP",
  "UI",
  "UID",
  "UUID",
  "URI",
  "URL",
  "UTF8",
  "VM",
  "XML",
  "XMPP",
  "XSRF",
  "XSS",
]);
