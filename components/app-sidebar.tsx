'use client'

import Link from "next/link"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuButton,
    SidebarGroupLabel,
    SidebarGroupContent,
    SidebarSeparator,
} from "@/components/ui/sidebar"
 
import {
    DropdownMenu,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuContent,
} from '@/components/ui/dropdown-menu'

import {
    ChevronDown,
    Rocket,
    User2,
    Table,
    Workflow,
    List,
    Plus,
    Import,
    RotateCcw,
    Search,
    ArrowLeftRight,
    Copy,
    KeyRound,
    Repeat,
    GitBranch,
} from "lucide-react"
import { RelayStatusIndicator } from "@/components/wss/relay-status-indicator"


export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center justify-between px-2 py-1.5">
          <RelayStatusIndicator />
        </div>
        <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton>
                            Select Workspace
                            <ChevronDown className="ml-auto" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[--radix-popper-anchor-width]">
                        <DropdownMenuItem>
                        <span>Acme Inc</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Wallets</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
               <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/wallet/explorer">
                    <List />
                    <span>Explorer</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem></SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/wallet/create">
                    <Plus />
                    <span>Create</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/wallet/add-existing">
                    <Import />
                    <span>Add existing</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
               <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/wallet/recover">
                    <RotateCcw />
                    <span>Recover</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/wallet/find">
                    <Search />
                    <span>Find</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/wallet/transfer">
                    <ArrowLeftRight />
                    <span>Transfer SOL</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Tokens</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/tokens/explorer">
                    <List />
                    <span>Explorer</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
               <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/tokens/create">
                    <Plus />
                    <span>Create</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/tokens/launch">
                    <Rocket />
                    <span>Launch</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/tokens/launch-builder">
                    <Workflow />
                    <span>Launch Builder</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
               <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/tokens/clone">
                    <Copy />
                    <span>Clone</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              
               <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/tokens/lookup-table">
                    <Table />
                    <span>Lookup Tables</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/tokens/vanity-address-import">
                    <KeyRound />
                    <span>Vanity Address Import</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Trade</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/trade/trade">
                    <Repeat />
                    <span>Single Trade</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
           <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <Link href="/protected/trade/strategy-trade">
                    <GitBranch />
                    <span>Strategy Trade</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
             
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton>
          <User2 /> {'Brian'}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarFooter>
    </Sidebar>
  )
}

