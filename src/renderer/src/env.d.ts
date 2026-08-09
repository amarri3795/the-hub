export {};

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    hub: import("../../preload/index").HubApi;
  }
}
