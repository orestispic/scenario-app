from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


OUTPUT = Path(__file__).resolve().parents[1] / "docs" / "Guide-installation-macOS.pdf"


def build_guide() -> None:
    pdfmetrics.registerFont(TTFont("ScenarioArial", "C:/Windows/Fonts/arial.ttf"))
    pdfmetrics.registerFont(TTFont("ScenarioArialBold", "C:/Windows/Fonts/arialbd.ttf"))
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "GuideTitle",
        parent=styles["Title"],
        fontName="ScenarioArialBold",
        fontSize=22,
        leading=27,
        textColor=HexColor("#20313b"),
        spaceAfter=16,
    )
    body = ParagraphStyle(
        "GuideBody",
        parent=styles["BodyText"],
        fontName="ScenarioArial",
        fontSize=11,
        leading=16,
        textColor=HexColor("#26333a"),
        spaceAfter=10,
    )
    heading = ParagraphStyle(
        "GuideHeading",
        parent=styles["Heading2"],
        fontName="ScenarioArialBold",
        fontSize=14,
        leading=18,
        textColor=HexColor("#2d628c"),
        spaceBefore=12,
        spaceAfter=10,
    )
    command = ParagraphStyle(
        "GuideCommand",
        parent=body,
        fontName="Courier",
        fontSize=10,
        leading=15,
        leftIndent=12,
        rightIndent=12,
        backColor=HexColor("#edf2f4"),
        borderColor=HexColor("#b8c3ca"),
        borderWidth=0.5,
        borderPadding=9,
        spaceBefore=4,
        spaceAfter=14,
    )
    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=2.2 * cm,
        rightMargin=2.2 * cm,
        topMargin=2.2 * cm,
        bottomMargin=2.2 * cm,
        title="Guide d’installation macOS — Scénario",
        author="Scénario",
    )
    story = [
        Paragraph("Installer Scénario sur Mac", title),
        Paragraph(
            "Le fichier <b>Scenario-macOS.zip</b> contient l’application "
            "<b>Scénario.app</b> et ce guide.",
            body,
        ),
        Paragraph("1. Télécharge puis décompresse <b>Scenario-macOS.zip</b>.<br/>"
                  "2. Glisse <b>Scénario.app</b> dans le dossier <b>Applications</b>.<br/>"
                  "3. Ouvre l’application.", body),
        Spacer(1, 4),
        Paragraph("Si macOS indique que l’application est « endommagée »", heading),
        Paragraph("1. Ouvre l’application <b>Terminal</b>.<br/>"
                  "2. Copie-colle exactement cette commande, puis appuie sur la touche Entrée :", body),
        Paragraph('xattr -cr "/Applications/Scénario.app"', command),
        Paragraph("3. Retourne dans le dossier <b>Applications</b>.<br/>"
                  "4. Fais un clic droit sur <b>Scénario.app</b>, puis choisis <b>Ouvrir</b> et confirme <b>Ouvrir</b>.", body),
        Paragraph("Cette manipulation n’est nécessaire qu’une seule fois.", body),
    ]
    document.build(story)


if __name__ == "__main__":
    build_guide()
