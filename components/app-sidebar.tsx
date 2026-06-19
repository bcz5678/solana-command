'use client'

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
} from "@/components/ui/sidebar"
 
import {
    DropdownMenu,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuContent,
} from '@/components/ui/dropdown-menu'

import { ChevronDown, Computer, Rocket, User2, Table} from "lucide-react"
import { RelayStatusIndicator } from "@/components/wss/relay-status-indicator"


export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-between px-2 py-1.5">
          <RelayStatusIndicator />
        </div>
        <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-2">
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
                  <a href="/protected/wallet/explorer">
                    <Computer />
                    <span>Explorer</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem></SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/wallet/create">
                    <Computer />
                    <span>Create</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/wallet/add-existing">
                    <Computer />
                    <span>Add existing</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
               <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/wallet/recover">
                    <Computer />
                    <span>Recover</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/wallet/find">
                    <Computer />
                    <span>Find</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/wallet/transfer">
                    <Computer />
                    <span>Transfer SOL</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Tokens</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/tokens/explorer">
                    <Computer />
                    <span>Explorer</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
               <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/tokens/create">
                    <Computer />
                    <span>Create</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/tokens/launch">
                    <Rocket />
                    <span>Launch</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
               <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/tokens/clone">
                    <Rocket />
                    <span>Clone</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              
               <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/tokens/lookup-table">
                    <Table />
                    <span>Lookup Tables</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/tokens/vanity-address-import">
                    <Computer />
                    <span>Vanity Address Import</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Trade</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/trade/trade">
                    <Computer />
                    <span>Single Trade</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
           <SidebarMenuItem>
                <SidebarMenuButton
                  className="min-w-8 bg-transparent text-sidebar-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  asChild
                >
                  <a href="/protected/trade/strategy-trade">
                    <Computer />
                    <span>Strategy Trade</span>
                  </a>
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

