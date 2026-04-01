"use client";

import React, { useState, useEffect } from "react";
import { Bell, Check, Loader2, MessageSquare } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "@/app/actions/notifications";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Notification {
    id: string;
    title: string;
    message: string;
    type: string;
    is_read: boolean;
    created_at: string;
    link_url?: string;
}

export function NotificationBell() {
    const [notifications, set_notifications] = useState<Notification[]>([]);
    const [unread_count, set_unread_count] = useState(0);
    const [is_loading, set_is_loading] = useState(false);

    const load_notifications = async () => {
        set_is_loading(true);
        const res = await fetchNotifications();
        if (res.success && res.notifications) {
            set_notifications(res.notifications as Notification[]);
            set_unread_count((res.notifications as Notification[]).filter(n => !n.is_read).length);
        }
        set_is_loading(false);
    };

    useEffect(() => {
        load_notifications();
        // Set up a basic interval for refreshing (could be replaced with real-time later if needed)
        const interval = setInterval(load_notifications, 60000);
        return () => clearInterval(interval);
    }, []);

    const handle_mark_as_read = async (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const res = await markNotificationAsRead(id);
        if (res.success) {
            set_notifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
            set_unread_count(prev => Math.max(0, prev - 1));
        }
    };

    const handle_mark_all_read = async () => {
        const res = await markAllNotificationsAsRead();
        if (res.success) {
            set_notifications(prev => prev.map(n => ({ ...n, is_read: true })));
            set_unread_count(0);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-5 w-5" />
                    {unread_count > 0 && (
                        <Badge
                            className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-red-500 border-2 border-white"
                            variant="destructive"
                        >
                            {unread_count > 9 ? "9+" : unread_count}
                        </Badge>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[380px] p-0">
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="font-semibold text-sm">Notifications</h3>
                    {unread_count > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                            onClick={handle_mark_all_read}
                        >
                            Mark all as read
                        </Button>
                    )}
                </div>

                <ScrollArea className="h-[400px]">
                    {is_loading && notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[200px] text-gray-400">
                            <Loader2 className="h-8 w-8 animate-spin mb-2" />
                            <p className="text-sm">Loading notifications...</p>
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[200px] text-gray-400">
                            <Bell className="h-8 w-8 mb-2 opacity-20" />
                            <p className="text-sm">No notifications yet</p>
                        </div>
                    ) : (
                        <div className="flex flex-col">
                            {notifications.map((notification) => (
                                <div
                                    key={notification.id}
                                    className={cn(
                                        "p-4 border-b last:border-0 hover:bg-gray-50 transition-colors relative group",
                                        !notification.is_read && "bg-blue-50/50"
                                    )}
                                >
                                    <div className="flex gap-3">
                                        <div className={cn(
                                            "mt-1 rounded-full p-2 h-9 w-9 flex items-center justify-center shrink-0",
                                            notification.type === 'internal_note' ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"
                                        )}>
                                            {notification.type === 'internal_note' ? (
                                                <MessageSquare className="h-4 w-4" />
                                            ) : (
                                                <Bell className="h-4 w-4" />
                                            )}
                                        </div>
                                        <div className="flex-1 space-y-1 pr-6">
                                            <div className="flex justify-between items-start">
                                                <p className={cn(
                                                    "text-sm font-medium leading-none",
                                                    !notification.is_read ? "text-gray-900" : "text-gray-600"
                                                )}>
                                                    {notification.title}
                                                </p>
                                            </div>
                                            <p className="text-xs text-gray-500">
                                                {notification.message}
                                            </p>
                                            <p className="text-[10px] text-gray-400">
                                                {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                                            </p>

                                            {notification.link_url && (
                                                <Link
                                                    href={notification.link_url}
                                                    className="text-[11px] text-emerald-600 hover:underline inline-block mt-1"
                                                >
                                                    View details
                                                </Link>
                                            )}
                                        </div>
                                    </div>

                                    {!notification.is_read && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 absolute top-4 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={(e) => handle_mark_as_read(notification.id, e)}
                                        >
                                            <Check className="h-3 w-3 text-gray-400" />
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
                <div className="p-2 border-t text-center">
                    <Button variant="ghost" size="sm" className="w-full text-xs text-gray-500 hover:bg-gray-50">
                        View all activity
                    </Button>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
