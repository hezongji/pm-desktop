import { Sidebar, Header } from '@/components/layout/sidebar'

interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="lg:pl-64">
        <Header />
        {/* page-enter：主内容区上浮淡入（主题统一动效，prefers-reduced-motion 自动禁用） */}
        <main className="page-enter container mx-auto py-6">{children}</main>
      </div>
    </div>
  )
}
