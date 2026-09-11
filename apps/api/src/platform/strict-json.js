function inspectJson(source) {
  let position = 0;
  const whitespace = () => { while (/\s/.test(source[position] ?? "")) position += 1; };
  function string() {
    const start = position;
    if (source[position++] !== '"') throw new SyntaxError("Expected JSON string");
    while (position < source.length) {
      if (source[position] === '"') {
        position += 1;
        return JSON.parse(source.slice(start, position));
      }
      if (source[position] === "\\") position += 1;
      position += 1;
    }
    throw new SyntaxError("Unterminated JSON string");
  }
  function value() {
    whitespace();
    const current = source[position];
    if (current === "{") {
      position += 1;
      whitespace();
      const keys = new Set();
      if (source[position] === "}") { position += 1; return; }
      while (true) {
        whitespace();
        const key = string();
        if (keys.has(key)) throw new SyntaxError("Duplicate JSON property");
        keys.add(key);
        whitespace();
        if (source[position++] !== ":") throw new SyntaxError("Expected colon");
        value();
        whitespace();
        if (source[position] === "}") { position += 1; return; }
        if (source[position++] !== ",") throw new SyntaxError("Expected comma");
      }
    }
    if (current === "[") {
      position += 1;
      whitespace();
      if (source[position] === "]") { position += 1; return; }
      while (true) {
        value();
        whitespace();
        if (source[position] === "]") { position += 1; return; }
        if (source[position++] !== ",") throw new SyntaxError("Expected comma");
      }
    }
    if (current === '"') { string(); return; }
    const remainder = source.slice(position);
    const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(remainder);
    if (primitive === null) throw new SyntaxError("Invalid JSON value");
    position += primitive[0].length;
  }
  whitespace();
  value();
  whitespace();
  if (position !== source.length) throw new SyntaxError("Trailing JSON content");
}

export function parseStrictJsonObject(source) {
  if (typeof source !== "string" || source === "") throw new SyntaxError("JSON body required");
  inspectJson(source);
  const parsed = JSON.parse(source);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("JSON object required");
  }
  return parsed;
}
