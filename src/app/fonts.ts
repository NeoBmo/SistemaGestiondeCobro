import localFont from "next/font/local";

export const brandSans = localFont({
  src: "./_fonts/IBMPlexSans-Variable.ttf",
  display: "swap",
  variable: "--font-brand-sans",
  weight: "100 700",
});

export const brandMono = localFont({
  src: "./_fonts/IBMPlexMono-Regular.ttf",
  display: "swap",
  variable: "--font-brand-mono",
  weight: "400",
});
