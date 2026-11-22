export class CatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
  }
}
