Pod::Spec.new do |s|
  s.name           = 'TailmanceDeviceIntegrity'
  s.version        = '0.1.0'
  s.summary        = 'Tailmance App Attest bridge'
  s.description    = 'Minimal Expo native bridge for Apple App Attest.'
  s.author         = 'Yekta Ozel'
  s.homepage       = 'https://tailmance.invalid'
  s.platforms      = { :ios => '14.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
