// Deklarasi minimal `jsdom` untuk test node (DOMParser XML di installers.test.ts). Paket
// @types/jsdom tidak dipasang; hanya API yang dipakai test yang dideklarasikan.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string)
    readonly window: Window & typeof globalThis
  }
}
