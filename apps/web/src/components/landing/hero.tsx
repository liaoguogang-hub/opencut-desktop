"use client";

import { Button } from "../ui/button";
import { ArrowRight } from "lucide-react";
import { Handlebars } from "./handlebars";
import Link from "next/link";

export function Hero() {
	const isDesktop = process.env.NEXT_PUBLIC_OPENCUT_DESKTOP === "1";
	return (
		<div
			className={
				isDesktop
					? // Desktop fork: solid theme background, no decorative image.
						// The upstream OpenCut site uses a fixed dark PNG here which
						// looks almost-black even after the `invert dark:invert-0`
						// filter, making the whole hero unreadable on the packaged app.
						"bg-background flex min-h-[calc(100svh-4.5rem)] flex-col items-center justify-between px-4 text-center"
					: "flex min-h-[calc(100svh-4.5rem)] flex-col items-center justify-between px-4 text-center"
			}
		>
			{!isDesktop && (
				<img
					className="absolute top-0 left-0 -z-50 size-full object-cover opacity-85 invert dark:invert-0"
					src="/landing-page-dark.png"
					alt="OpenCut video editor landing page background"
				/>
			)}
			<div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center">
				<div className="inline-block text-4xl font-bold tracking-tighter md:text-[4rem]">
					<h1>The open source</h1>
					<Handlebars>Video editor</Handlebars>
				</div>

				<p className="text-muted-foreground mx-auto mt-10 max-w-xl text-base font-light tracking-wide sm:text-xl">
					A simple but powerful video editor that gets the job done. Works on
					any platform.
				</p>

				<div className="mt-8 flex justify-center gap-8">
					<Link href="/projects">
						<Button type="submit" size="lg" className="h-11 text-base">
							Try early beta
							<ArrowRight className="ml-0.5" />
						</Button>
					</Link>
				</div>
			</div>
		</div>
	);
}
