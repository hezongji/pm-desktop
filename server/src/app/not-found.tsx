import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <FileQuestion className="h-8 w-8 text-primary" />
      </div>
      <h1 className="mt-6 text-5xl font-bold tracking-tight text-foreground">
        404
      </h1>
      <p className="mt-3 text-base text-muted-foreground">
        页面不存在或已被移动，请检查地址是否正确
      </p>
      <div className="mt-8 flex items-center gap-3">
        <Link href="/" className="btn btn-primary h-10 px-5 text-sm">
          返回工作台
        </Link>
        <Link href="/help" className="btn btn-outline h-10 px-5 text-sm">
          帮助中心
        </Link>
      </div>
      <p className="mt-12 text-xs text-muted-foreground">
        PM 项目管理系统
      </p>
    </div>
  )
}
