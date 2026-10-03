const SUPABASE_ALLOWED_SYMBOL=/[!@#$%^&*()_+\-=\[\]{};'\\:\"|<>?,./`~]/;

export function passwordMeetsPolicy(password:string){
  return password.length>=12
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && SUPABASE_ALLOWED_SYMBOL.test(password);
}
