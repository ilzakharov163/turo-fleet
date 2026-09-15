export interface Car {
  id: string
  make: string
  model: string
  plate: string
  status: 'active' | 'inactive'
  inactive_reason?: string
  active_days_override?: number | null
  owner_group: 'main' | 'ilya'
  delisted: boolean
  created_at: string
  updated_at: string
}

export interface CarBlock {
  id: string
  car_id: string
  start_date: string
  end_date: string
  reason?: string
  created_by: string
  created_at: string
  car?: Car
}

export interface Expense {
  id: string
  car_id: string
  title: string
  notes?: string
  amount: number
  date: string
  files: string[]
  paid: boolean
  created_by: string
  created_at: string
  updated_at: string
  car?: Car
}

export interface Maintenance {
  id: string
  car_id: string
  oil_change_date?: string
  oil_change_miles?: number
  notes?: string
  updated_at: string
  car?: Car
}

export interface TeamMember {
  id: string
  email: string
  full_name?: string
  role: 'operator'
  invited_by: string
  invited_at: string
  joined_at?: string
  status: 'pending' | 'active'
}

export interface ActivityLog {
  id: string
  user_id: string
  user_email: string
  action: string
  entity_type: string
  entity_id: string
  details: Record<string, unknown>
  created_at: string
}
