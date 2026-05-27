declare module '*.tflite' {
  const resource: number;
  export default resource;
}

// React Native runtime provides btoa/atob but the RN tsconfig doesn't include the DOM lib.
declare function btoa(data: string): string;
declare function atob(encodedData: string): string;
