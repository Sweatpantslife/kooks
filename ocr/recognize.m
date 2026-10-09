#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <ImageIO/ImageIO.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 1;
    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
    CGImageSourceRef imageSource = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
    if (!imageSource) return 2;
    NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(imageSource, 0, NULL));
    CFRelease(imageSource);
    long width = [properties[(__bridge NSString *)kCGImagePropertyPixelWidth] longValue];
    long height = [properties[(__bridge NSString *)kCGImagePropertyPixelHeight] longValue];
    if (width <= 0 || height <= 0 || width > 20000 || height > 20000 || width * height > 40000000) return 3;
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = YES;
    if (@available(macOS 13.0, *)) request.automaticallyDetectsLanguage = YES;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[request] error:&error]) {
      fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
      return 4;
    }
    for (VNRecognizedTextObservation *observation in request.results) {
      VNRecognizedText *text = [observation topCandidates:1].firstObject;
      if (text) printf("%s\n", text.string.UTF8String);
    }
  }
  return 0;
}
