"use client";

import * as React from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Carousel,
    CarouselContent,
    CarouselItem,
} from "@/components/ui/carousel";

import Autoplay from "embla-carousel-autoplay";

const banners = [
    {
        id: 1,
        title: "Personal Credit Score - Option 1",
        image: "/myscoreiq 1.png",
        link: "https://member.myscoreiq.com/business-credit-max.aspx?offercode=432139I0",
        type: "Personal Credit"
    },
    {
        id: 2,
        title: "Personal Credit Score - Option 2",
        image: "/myscoreiq 2.png",
        link: "https://member.myscoreiq.com/business-credit-max.aspx?offercode=432139I0",
        type: "Personal Credit"
    },
    {
        id: 3,
        title: "Business Credit Score",
        image: "/myscoreiq 3.png",
        link: "https://member.myscoreiq.com/business-credit-max.aspx?offercode=432139I0",
        type: "Business Credit"
    }
];

export function MyScoreIQCarousel() {
    // Keep a stable array reference so Embla doesn't tear down the plugin on re-renders
    const [plugins] = React.useState(() => [
        Autoplay({ delay: 5000, stopOnInteraction: false })
    ]);

    return (
        <div className="bg-white border-none shadow-none mt-8 w-full">
            <div className="pb-4 pt-2 mb-2">
                <h3 className="text-xl font-black text-emerald-950 tracking-tighter uppercase flex items-center gap-2">
                    Recommended Next Steps
                </h3>
                <p className="text-emerald-900/60 font-bold mt-1 text-sm">
                    Access your credit scores securely through MyScoreIQ
                </p>
            </div>
            <div className="w-full relative">
                <Carousel
                    opts={{
                        align: "start",
                        loop: true,
                    }}
                    plugins={plugins}
                    className="w-full relative group"
                >
                    <CarouselContent className="-ml-2 md:-ml-4">
                        {banners.map((banner) => (
                            <CarouselItem key={banner.id} className="pl-2 md:pl-4 basis-full">
                                <a
                                    href={banner.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block relative w-full overflow-hidden rounded-2xl md:rounded-[2rem] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/50"
                                >
                                    <img
                                        src={banner.image}
                                        alt={banner.title}
                                        className="w-full h-auto object-contain transition-transform duration-700 hover:scale-[1.01]"
                                        loading="eager"
                                    />
                                </a>
                            </CarouselItem>
                        ))}
                    </CarouselContent>
                </Carousel>
            </div>
        </div>
    );
}
