'use client'

import * as React from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth'
import { AuthService } from '@/services'
import { validateEmail } from '@/lib/utils'
import Link from 'next/link'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

const loginSchema = z.object({
  email: z.string().min(1, '请输入登录账号（姓名 / 拼音 / 邮箱）'),
  password: z.string().min(1, '请输入密码'),
})

type LoginFormData = z.infer<typeof loginSchema>

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()
  const { toast } = useToast()
  const { login } = useAuthStore()

  // 记住我（2026-08-22 UIUX P1 修复）：记住账号名到 localStorage，避免每次重输
  // 注意：SSR 无 localStorage，必须防御式读取（typeof window 检查）
  const [rememberMe, setRememberMe] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  // 挂载后读取记住的账号（client-only）
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem('pm-remember-account')
      if (saved === '1') {
        setRememberMe(true)
        const email = localStorage.getItem('pm-remember-email')
        if (email) setValue('email', email)
      }
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, [setValue])

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true)
    try {
      if (rememberMe) {
        localStorage.setItem('pm-remember-account', '1')
        localStorage.setItem('pm-remember-email', data.email)
      } else {
        localStorage.removeItem('pm-remember-account')
        localStorage.removeItem('pm-remember-email')
      }
      const response = await AuthService.login(data.email, data.password)

      if (response.success && response.data) {
        localStorage.setItem('auth-token', response.data.token)
        login(response.data.user)

        toast({
          title: '登录成功',
          description: `欢迎回来，${response.data.user.name}！`,
        })

        // 登录后自动进入全屏（类桌面应用体验）；被浏览器拒绝时静默降级
        try {
          if (typeof document !== 'undefined' && !document.fullscreenElement) {
            await document.documentElement.requestFullscreen()
          }
        } catch {
          /* 忽略全屏失败，不影响登录 */
        }

        // 登录后回跳：?next= 参数（W1-I3，防开放重定向仅允许站内路径）；否则进工作台
        // 强制改密（2026-09-02 评测 fix-1）：mustChangePassword 时只进改密页，忽略 next
        if (response.data.user.mustChangePassword) {
          router.push('/change-password')
          return
        }
        let target = '/'
        if (typeof window !== 'undefined') {
          const next = new URLSearchParams(window.location.search).get('next')
          if (next && next.startsWith('/') && !next.startsWith('//'))
            target = next
        }
        router.push(target)
      } else {
        toast({
          title: '登录失败',
          description: response.message || '请检查您的账号和密码',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: '登录失败',
        description: '网络错误，请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="page-enter flex min-h-screen items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          {/* 公司 Logo */}
          <img
            src="/logo.png"
            alt="PM 项目管理系统"
            className="mx-auto h-20 w-20 object-contain drop-shadow-sm"
          />
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
            PM 项目管理系统
          </h2>
          <p className="eyebrow mt-1.5">本地优先 · 数据自持</p>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>登录</CardTitle>
            <CardDescription>请输入公司分配的账号和密码</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={e => {
                // 防原生 GET 提交（UIUX P1 修复：账号密码误入 URL 查询串）
                e.preventDefault()
                handleSubmit(onSubmit)(e)
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="email">登录账号（姓名 / 拼音 / 邮箱）</Label>
                <Input
                  id="email"
                  type="text"
                  placeholder="姓名 / 拼音 / 邮箱"
                  autoComplete="username"
                  {...register('email')}
                  className={errors.email ? 'border-destructive' : ''}
                />
                {errors.email && (
                  <p className="text-sm text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    {...register('password')}
                    className={errors.password ? 'border-destructive' : ''}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                    className="absolute inset-y-0 right-0 flex items-center pr-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-sm text-destructive">
                    {errors.password.message}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                  />
                  <label
                    htmlFor="remember-me"
                    className="ml-2 block text-sm text-foreground"
                  >
                    记住我
                  </label>
                </div>

                <div className="text-sm">
                  <Link
                    href="/forgot-password"
                    className="font-medium text-primary hover:text-primary/80"
                  >
                    忘记密码？
                  </Link>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    登录中...
                  </>
                ) : (
                  '登录'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          © 2026 hezongji · PM 项目管理系统 v2
        </p>
      </div>
    </div>
  )
}
