Pod::Spec.new do |s|
  s.name           = 'TailmanceSystemCalls'
  s.version        = '0.1.0'
  s.summary        = 'Tailmance native system-call integration'
  s.description    = 'CallKit and PushKit bridge for Tailmance matched-pet calls.'
  s.author         = 'Yekta Ozel'
  s.homepage       = 'https://tailmance.invalid'
  s.platforms      = { :ios => '14.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.frameworks = 'CallKit', 'PushKit', 'AVFAudio'
  s.swift_version = '5.9'
end
