const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

export function info(line: string): void {
  process.stdout.write(`${C.dim}${line}${C.reset}\n`);
}

export function success(line: string): void {
  process.stdout.write(`${C.green}✓${C.reset} ${line}\n`);
}

export function step(line: string): void {
  process.stdout.write(`${C.cyan}${line}${C.reset}\n`);
}

export function warn(line: string): void {
  process.stdout.write(`${C.yellow}!${C.reset} ${line}\n`);
}

export function fail(line: string): void {
  process.stderr.write(`${C.red}✗${C.reset} ${line}\n`);
}

export function dim(line: string): string {
  return `${C.dim}${line}${C.reset}`;
}

export function bold(line: string): string {
  return `${C.bold}${line}${C.reset}`;
}
