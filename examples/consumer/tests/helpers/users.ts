import User from '#models/user'

export async function createUser(email: string) {
  return User.create({ email, password: 'secret-password', fullName: email })
}
