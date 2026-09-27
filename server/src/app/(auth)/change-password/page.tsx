'use client'

/**
 * /change-password —— 首登/重置后强制改密（2026-09-02 评测 fix-1 / S1）
 *
 * 登录响应 mustChangePassword=true 时强制进入本页；未改完不放行主界面。
 * AuthGuard 会拦截会话恢复路径（localStorage 里仍是旧标记时重定向到此）。
 */

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
import { useLogout } from '@/hooks/use-logout'
import { AuthService } from '@/services'
import { Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react'

const changeSchema = z
  .object({
    oldPassword: z.string().min(1, '请输入当前密码'),
    newPassword: z
      .string()
      .min(8, '新密码至少 8 位')
      .regex(/[A-Za-z]/, '新密码需包含字母')
      .regex(/[0-9]/, '新密码需包含数字'),
    confirmPassword: z.string().min(1, '请再次输入新密码'),
  })
  .refine(d => d.newPassword === d.confirmPassword, {
    message: '两次输入的新密码不一致',
    path: ['confirmPassword'],
  })

type ChangeFormData = z.infer<typeof changeSchema>

export default function ChangePasswordPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user, updateUser } = useAuthStore()
  const doLogout = useLogout()
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangeFormData>({
    resolver: zodResolver(changeSchema),
    defaultValues: { oldPassword: '', newPassword: '', confirmPassword: '' },
  })

  const onSubmit = async (data: ChangeFormData) => {
    setIsLoading(true)
    try {
      const response = await AuthService.changePassword(
        data.oldPassword,
        data.newPassword
      )
      if (response.success) {
        // 20260908 生产审计修复 P1-3：改密已使 tokenVersion 自增（旧令牌全部失效），
        // 服务端返回新 token，必须写回本地，否则改密即被踢下线。
        const newToken = response.data?.token
        if (newToken) {
          try {
            localStorage.setItem('auth-token', newToken)
          } catch {
            /* localStorage 不可用（隐私模式）忽略，服务端仍已改密成功 */
          }
        }
        updateUser({ mustChangePassword: false })
        // localStorage 里的缓存用户同步（AuthProvider 读这份）
        try {
          const cached = localStorage.getItem('auth-user')
          if (cached) {
            const parsed = JSON.parse(cached)
            parsed.mustChangePassword = false
            localStorage.setItem('auth-user', JSON.stringify(parsed))
          }
        } catch {
          /* 缓存解析失败忽略，store 已更新 */
        }
        toast({ title: '密码修改成功', description: '即将进入工作台' })
        router.replace('/')
      } else {
        toast({
          title: '修改失败',
          description: response.message || '请检查当前密码是否正确',
          variant: 'destructive',
        })
      }
    } catch (e) {
      toast({
        title: '修改失败',
        description: e instanceof Error ? e.message : '网络错误，请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <ShieldAlert className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
          <CardTitle className="text-xl">首次登录请修改密码</CardTitle>
          <CardDescription>
            {user?.name ? `${user.name}，` : ''}
            当前使用初始密码，为保障账户安全， 请设置新密码后继续使用（至少 8
            位，含字母与数字）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="oldPassword">当前密码</Label>
              <div className="relative">
                <Input
                  id="oldPassword"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="初始密码"
                  {...register('oldPassword')}
                />
                <button
                  type="button"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  title={showPassword ? '隐藏密码' : '显示密码'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowPassword(v => !v)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.oldPassword && (
                <p className="text-sm text-destructive">
                  {errors.oldPassword.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="至少 8 位，含字母与数字"
                {...register('newPassword')}
              />
              {errors.newPassword && (
                <p className="text-sm text-destructive">
                  {errors.newPassword.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认新密码</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="再次输入新密码"
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              修改密码并进入系统
            </Button>

            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground hover:underline"
              onClick={() => {
                void doLogout()
              }}
            >
              使用其他账号登录
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
