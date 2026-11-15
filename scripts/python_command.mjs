/* One interpreter policy for all Node-based repository harnesses. */
export const PYTHON = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
