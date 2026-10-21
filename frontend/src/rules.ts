// Week-2 input rules shared by the screens (the activity form checks them in create.tsx). The server must re-check the same rules (docs/rules.md).
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
