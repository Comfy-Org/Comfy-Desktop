import AppKit
import CoreGraphics
import CoreText

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write("usage: swift scripts/build-installer-art.swift <formula-font-dir>\n".data(using: .utf8)!)
    exit(1)
}
let fontDir = CommandLine.arguments[1]
let repo = URL(fileURLWithPath: #filePath).standardizedFileURL.deletingLastPathComponent().deletingLastPathComponent().path
let resources = "\(repo)/resources"
let logoPath = "\(repo)/assets/Comfy_Logo_x512.png"
guard FileManager.default.fileExists(atPath: "\(resources)/dmg"), FileManager.default.fileExists(atPath: logoPath) else {
    FileHandle.standardError.write("cannot find resources/dmg or the logo under \(repo)\n".data(using: .utf8)!)
    exit(1)
}
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

let ink: UInt32 = 0x211927
let inkLight: UInt32 = 0x2A2330
let yellow: UInt32 = 0xF2FF59
let canvasColor: UInt32 = 0xC2BFB9
let warmWhite: UInt32 = 0xF0EFED
let warmGray: UInt32 = 0x7E7C78
let systemWhite: UInt32 = 0xFFFFFF

func cgColor(_ hex: UInt32, _ alpha: Double = 1) -> CGColor {
    CGColor(srgbRed: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255, alpha: alpha)
}

func formula(_ cut: String, _ size: Double) -> NSFont {
    let path = "\(fontDir)/PPFormula-\(cut).woff2"
    guard let data = FileManager.default.contents(atPath: path),
          let descriptors = CTFontManagerCreateFontDescriptorsFromData(data as CFData) as? [CTFontDescriptor],
          let descriptor = descriptors.first else {
        FileHandle.standardError.write("missing font \(path)\n".data(using: .utf8)!)
        exit(1)
    }
    return CTFontCreateWithFontDescriptor(descriptor, size, nil) as NSFont
}

final class Canvas {
    let widthPt: Double
    let heightPt: Double
    let scale: Double
    let ctx: CGContext

    init(widthPt: Double, heightPt: Double, scale: Double) {
        self.widthPt = widthPt
        self.heightPt = heightPt
        self.scale = scale
        ctx = CGContext(data: nil, width: Int(widthPt * scale), height: Int(heightPt * scale),
                        bitsPerComponent: 8, bytesPerRow: 0, space: sRGB,
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    }

    func point(_ x: Double, _ y: Double) -> CGPoint {
        CGPoint(x: x * scale, y: (heightPt - y) * scale)
    }

    func rect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) -> CGRect {
        CGRect(x: x * scale, y: (heightPt - y - height) * scale, width: width * scale, height: height * scale)
    }

    func fill(_ color: UInt32) {
        ctx.setFillColor(cgColor(color))
        ctx.fill(rect(0, 0, widthPt, heightPt))
    }

    func text(_ string: String, centerX: Double, top: Double, font: NSFont, color: UInt32) {
        let scaled = NSFont(descriptor: font.fontDescriptor, size: font.pointSize * scale)!
        let attributed = NSAttributedString(string: string, attributes: [
            .font: scaled, .foregroundColor: NSColor(cgColor: cgColor(color))!])
        let size = attributed.size()
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
        attributed.draw(at: CGPoint(x: centerX * scale - size.width / 2, y: (heightPt - top) * scale - size.height))
        NSGraphicsContext.restoreGraphicsState()
    }

    func image(_ path: String, centerX: Double, centerY: Double, size: Double) {
        let image = NSImage(contentsOfFile: path)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
        image.draw(in: rect(centerX - size / 2, centerY - size / 2, size, size))
        NSGraphicsContext.restoreGraphicsState()
    }

    func nodeCard(x: Double, y: Double, width: Double, height: Double, band: Double, bandColor: UInt32 = canvasColor) {
        let radius = 10 * scale
        let path = CGPath(roundedRect: rect(x, y, width, height), cornerWidth: radius, cornerHeight: radius, transform: nil)
        ctx.setFillColor(cgColor(inkLight))
        ctx.addPath(path)
        ctx.fillPath()
        if band > 0 {
            ctx.saveGState()
            ctx.addPath(path)
            ctx.clip()
            ctx.setFillColor(cgColor(bandColor))
            ctx.fill(rect(x, y + height - band, width, band))
            ctx.restoreGState()
        }
        ctx.setStrokeColor(cgColor(warmGray, 0.55))
        ctx.setLineWidth(1 * scale)
        ctx.addPath(path)
        ctx.strokePath()
    }

    func link(from start: CGPoint, _ control1: CGPoint, _ control2: CGPoint, to end: CGPoint, color: UInt32) {
        ctx.setStrokeColor(cgColor(color))
        ctx.setLineWidth(2.5 * scale)
        ctx.setLineCap(.round)
        ctx.move(to: point(start.x, start.y))
        ctx.addCurve(to: point(end.x, end.y), control1: point(control1.x, control1.y), control2: point(control2.x, control2.y))
        ctx.strokePath()
    }

    func outputPort(_ at: CGPoint, color: UInt32) {
        let center = point(at.x, at.y), radius = 4.5 * scale
        ctx.setFillColor(cgColor(color))
        ctx.fillEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: 2 * radius, height: 2 * radius))
    }

    func inputPort(_ at: CGPoint, color: UInt32, background: UInt32) {
        let center = point(at.x, at.y), radius = 4.5 * scale
        let circle = CGRect(x: center.x - radius, y: center.y - radius, width: 2 * radius, height: 2 * radius)
        ctx.setFillColor(cgColor(background))
        ctx.fillEllipse(in: circle)
        ctx.setStrokeColor(cgColor(color))
        ctx.setLineWidth(2 * scale)
        ctx.strokeEllipse(in: circle)
    }

    func writePNG(_ path: String) {
        let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
        rep.size = NSSize(width: widthPt, height: heightPt)
        try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
        print("wrote \(path)")
    }

    func writeBMP24(_ path: String) {
        let width = ctx.width, height = ctx.height
        let source = ctx.data!.bindMemory(to: UInt8.self, capacity: ctx.bytesPerRow * height)
        let rowSize = (width * 3 + 3) & ~3
        let imageSize = rowSize * height
        var bytes = [UInt8]()
        func le32(_ value: Int) { bytes += [0, 8, 16, 24].map { UInt8((value >> $0) & 0xFF) } }
        func le16(_ value: Int) { bytes += [UInt8(value & 0xFF), UInt8((value >> 8) & 0xFF)] }
        bytes += [0x42, 0x4D]
        le32(54 + imageSize); le32(0); le32(54)
        le32(40); le32(width); le32(height); le16(1); le16(24); le32(0); le32(imageSize)
        le32(2835); le32(2835); le32(0); le32(0)
        for row in 0..<height {
            let sourceRow = source + (height - 1 - row) * ctx.bytesPerRow
            for column in 0..<width {
                let pixel = sourceRow + column * 4
                bytes += [pixel[2], pixel[1], pixel[0]]
            }
            bytes += [UInt8](repeating: 0, count: rowSize - width * 3)
        }
        try! Data(bytes).write(to: URL(fileURLWithPath: path))
        print("wrote \(path)")
    }
}

let dmgCanvasWidth = 4096.0
let dmgCanvasHeight = 2560.0
let dmgApp = CGPoint(x: 135, y: 270)
let dmgFolder = CGPoint(x: 405, y: 190)

func drawDMGBackground(scale: Double) -> Canvas {
    let canvas = Canvas(widthPt: dmgCanvasWidth, heightPt: dmgCanvasHeight, scale: scale)
    canvas.fill(ink)
    canvas.text("Comfy Desktop", centerX: 270, top: 52, font: formula("Medium", 22), color: warmWhite)
    canvas.text("Drag to Applications to install", centerX: 270, top: 84, font: formula("Regular", 13), color: canvasColor)
    let cardWidth = 128.0, cardHeight = 128.0, cardTopAboveIcon = 57.0
    for icon in [dmgApp, dmgFolder] {
        canvas.nodeCard(x: icon.x - cardWidth / 2, y: icon.y - cardTopAboveIcon, width: cardWidth, height: cardHeight,
                        band: 24, bandColor: warmGray)
    }
    let output = CGPoint(x: dmgApp.x + cardWidth / 2, y: dmgApp.y)
    let input = CGPoint(x: dmgFolder.x - cardWidth / 2, y: dmgFolder.y)
    let pull = (input.x - output.x) / 2
    canvas.link(from: output, CGPoint(x: output.x + pull, y: output.y),
                CGPoint(x: input.x - pull, y: input.y), to: input, color: yellow)
    canvas.outputPort(output, color: yellow)
    canvas.inputPort(input, color: yellow, background: inkLight)
    return canvas
}

func drawWindowsSidebar(connected: Bool) -> Canvas {
    let canvas = Canvas(widthPt: 164, heightPt: 314, scale: 1)
    canvas.fill(ink)
    let card = (x: 14.0, y: 56.0, width: 100.0, height: 100.0)
    canvas.nodeCard(x: card.x, y: card.y, width: card.width, height: card.height, band: 22)
    canvas.image(logoPath, centerX: card.x + card.width / 2, centerY: card.y + 39, size: 50)
    canvas.text("Comfy Desktop", centerX: card.x + card.width / 2, top: card.y + card.height - 17,
                font: formula("Medium", 11), color: ink)
    let next = (x: 64.0, y: 232.0)
    canvas.nodeCard(x: next.x, y: next.y, width: 140, height: 130, band: 0)
    let output = CGPoint(x: card.x + card.width, y: card.y + 39)
    let input = CGPoint(x: next.x, y: next.y + 36)
    if connected {
        canvas.link(from: output, CGPoint(x: output.x + 40, y: output.y + 90),
                    CGPoint(x: input.x - 40, y: input.y - 30), to: input, color: yellow)
    } else {
        canvas.link(from: output, CGPoint(x: output.x + 26, y: output.y),
                    CGPoint(x: output.x + 32, y: output.y + 30), to: CGPoint(x: output.x + 18, y: output.y + 52), color: yellow)
    }
    canvas.outputPort(output, color: yellow)
    canvas.inputPort(input, color: yellow, background: inkLight)
    return canvas
}

func drawWindowsHeader() -> Canvas {
    let canvas = Canvas(widthPt: 150, heightPt: 57, scale: 1)
    canvas.fill(systemWhite)
    let iconSize = 41.0, iconCenterX = 150 - 8 - iconSize / 2, iconCenterY = 28.5
    canvas.image(logoPath, centerX: iconCenterX, centerY: iconCenterY, size: iconSize)
    let input = CGPoint(x: iconCenterX - iconSize / 2 - 3, y: iconCenterY)
    let output = CGPoint(x: 52, y: 40)
    canvas.link(from: output, CGPoint(x: output.x + 22, y: output.y), CGPoint(x: input.x - 22, y: input.y), to: input, color: ink)
    canvas.outputPort(output, color: ink)
    canvas.inputPort(input, color: ink, background: systemWhite)
    return canvas
}

let dmgDir = "\(resources)/dmg"
drawDMGBackground(scale: 1).writePNG("\(dmgDir)/background.png")
drawDMGBackground(scale: 2).writePNG("\(dmgDir)/background@2x.png")
let tiffutil = Process()
tiffutil.executableURL = URL(fileURLWithPath: "/usr/bin/tiffutil")
tiffutil.arguments = ["-cathidpicheck", "\(dmgDir)/background.png", "\(dmgDir)/background@2x.png",
                      "-out", "\(dmgDir)/background.tiff"]
try! tiffutil.run()
tiffutil.waitUntilExit()
guard tiffutil.terminationStatus == 0 else {
    FileHandle.standardError.write("tiffutil failed with status \(tiffutil.terminationStatus)\n".data(using: .utf8)!)
    exit(1)
}

drawWindowsSidebar(connected: true).writeBMP24("\(resources)/installerSidebar.bmp")
drawWindowsSidebar(connected: false).writeBMP24("\(resources)/uninstallerSidebar.bmp")
drawWindowsHeader().writeBMP24("\(resources)/installerHeader.bmp")
