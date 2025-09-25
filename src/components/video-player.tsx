"use client"

import { useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"


interface VideoPlayerProps {
  videoUrl: string
  title: string
}

export default function VideoPlayer({ videoUrl, title }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="bg-slate-100 border-slate-200 overflow-hidden">
        <CardContent className="p-0">
          <div className="relative aspect-video bg-black">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-50 border-slate-200">
        <CardContent className="p-4">
          <h3 className="text-slate-900 font-medium mb-2">{title}</h3>
          <p className="text-slate-600 text-sm">
            {/* Aquí podrías insertar una descripción que venga de la base de datos */}
            Enjoy this lesson and apply it to your business growth!
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
