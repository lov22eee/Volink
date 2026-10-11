// Week-2 input rules shared by the screens. The server must re-check the same rules (docs/rules.md).
export const activityRules = {
  titleMin: 5, titleMax: 100,
  capacityMin: 2, capacityMax: 10,
  durationMin: 30, durationMax: 180,
  descriptionMin: 20, descriptionMax: 2000,
  earliestStart: '06:00', latestEnd: '22:00',
  minLeadHours: 24, maxDaysAhead: 60,
}

export const signupRules = { nameMax: 40, passwordMin: 8, passwordMax: 72, minimumAge: 14, maxInterests: 3 }

export type Errors = Record<string, string>

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim()
const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m }

export function validateActivity(data: FormData, now = new Date()): Errors {
  const r = activityRules
  const errors: Errors = {}
  const title = text(data, 'title')
  if (title.length < r.titleMin || title.length > r.titleMax) errors.title = `활동 이름은 ${r.titleMin}~${r.titleMax}자로 입력해 주세요.`
  if (!text(data, 'place')) errors.place = '장소를 선택해 주세요.'
  const date = text(data, 'date')
  const time = text(data, 'time')
  const duration = Number(text(data, 'duration'))
  if (!date) errors.date = '활동 날짜를 선택해 주세요.'
  if (!time) errors.time = '시작 시간을 입력해 주세요.'
  if (date && time) {
    const start = new Date(`${date}T${time}:00+09:00`)
    const hoursAhead = (start.getTime() - now.getTime()) / 3_600_000
    if (hoursAhead < r.minLeadHours) errors.date = `활동은 지금부터 ${r.minLeadHours}시간 이후로 정해 주세요.`
    else if (hoursAhead > r.maxDaysAhead * 24) errors.date = `활동은 ${r.maxDaysAhead}일 이내로 정해 주세요.`
    if (minutes(time) < minutes(r.earliestStart)) errors.time = `시작 시간은 ${r.earliestStart} 이후로 정해 주세요.`
    else if (Number.isInteger(duration) && minutes(time) + duration > minutes(r.latestEnd)) errors.time = `활동은 ${r.latestEnd} 전에 끝나야 합니다.`
  }
  const capacity = Number(text(data, 'capacity'))
  if (!Number.isInteger(capacity) || capacity < r.capacityMin || capacity > r.capacityMax) errors.capacity = `모집 정원은 ${r.capacityMin}~${r.capacityMax}명입니다.`
  if (!Number.isInteger(duration) || duration < r.durationMin || duration > r.durationMax) errors.duration = `활동 시간은 ${r.durationMin}~${r.durationMax}분입니다.`
  const description = text(data, 'description')
  if (description.length < r.descriptionMin || description.length > r.descriptionMax) errors.description = `활동 소개는 ${r.descriptionMin}~${r.descriptionMax}자로 적어 주세요.`
  if (data.getAll('safety').length < 2) errors.safety = '안전 안내 두 항목을 모두 확인해 주세요.'
  return errors
}

export function ageOn(birthDate: string, today: Date) {
  const [y, m, d] = birthDate.split('-').map(Number)
  // en-CA formats as YYYY-MM-DD; age is counted on the Korean calendar date.
  const [ty, tm, td] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(today).split('-').map(Number)
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0)
}

export function validateSignup(data: FormData, institution: boolean, now = new Date()): Errors {
  const r = signupRules
  const errors: Errors = {}
  const name = text(data, 'name')
  if (!name || name.length > r.nameMax) errors.name = `이름을 1~${r.nameMax}자로 입력해 주세요.`
  const birthDate = text(data, 'birthDate')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) errors.birthDate = '생년월일을 입력해 주세요.'
  else if (ageOn(birthDate, now) < r.minimumAge) errors.birthDate = `만 ${r.minimumAge}세 미만은 가입할 수 없습니다.`
  const interests = data.getAll('interests').length
  if (interests < 1 || interests > r.maxInterests) errors.interests = `관심 분야를 1~${r.maxInterests}개 골라 주세요.`
  if (institution) {
    const organization = text(data, 'organization')
    if (organization.length < 2 || organization.length > 100) errors.organization = '기관명을 2~100자로 입력해 주세요.'
    if (!/^[0-9-]{9,20}$/.test(text(data, 'organizationContact'))) errors.organizationContact = '연락처는 숫자와 - 로 9~20자 입력해 주세요.'
  }
  const email = text(data, 'email')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = '이메일 형식을 확인해 주세요.'
  const password = String(data.get('password') ?? '')
  if (password.length < r.passwordMin || password.length > r.passwordMax || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    errors.password = `비밀번호는 영문과 숫자를 섞어 ${r.passwordMin}~${r.passwordMax}자로 입력해 주세요.`
  else if (password !== String(data.get('passwordConfirm') ?? '')) errors.passwordConfirm = '비밀번호가 일치하지 않습니다.'
  if (!data.get('notice')) errors.notice = '이용 안내를 확인해 주세요.'
  return errors
}
