import type { Metadata } from "next";
import { Montserrat, Open_Sans, Roboto_Mono } from "next/font/google";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-farmer-heading",
  weight: ["600", "700"],
});

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-farmer-body",
  weight: ["400", "500", "600"],
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-farmer-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Farmer harvest intake",
  description: "Submit harvest and handling data to your digital twin base.",
};

export default function FarmerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className={`${montserrat.variable} ${openSans.variable} ${robotoMono.variable} min-h-full`}
    >
      {children}
    </div>
  );
}
