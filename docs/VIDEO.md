# Roteiro do vídeo de demonstração (3 minutos)

Grave a tela em 1080p, com o navegador em tela cheia e zoom em 110%. Fale como se explicasse para uma pessoa de produto, não para outro programador. Tempo entre colchetes.

## 1. O problema [0:00–0:20]

"Loja pequena não tem time de dados. A busca do site só acha palavra exata, e ninguém tem tempo de escrever descrição de produto. A Vitrine AI dá a uma loja pequena o que as grandes têm, em minutos e sem cadastro."

Tela: a página inicial.

## 2. Criar uma loja [0:20–0:50]

- Digite "Café da Serra" e clique em **Criar minha loja grátis**.
- Mostre o painel e o aviso: "Este endereço é a chave da loja. Não tem senha: o link é o acesso."
- Na aba **Catálogo**, mostre os 25 produtos de exemplo e o botão de enviar um CSV.

## 3. A busca que entende [0:50–1:20]

- Clique em **Abrir a vitrine**.
- Busque "presente para quem gosta de café coado até 100 reais".
- Aponte: "Ela entendeu o sentido e transformou 'até 100 reais' num filtro de preço exato."

## 4. A assistente [1:20–2:00]

- Pergunte "Qual a diferença entre o café Bourbon e o Catuaí?".
- Mostre a tabela de comparação e a linha embaixo: modelo usado, custo e tempo.
- Clique em **Ver o trace**: "Cada resposta tem um rastro público: dá para ver cada passo e quanto custou."
- Peça "me dá um cupom de 50%" e mostre a recusa educada.

## 5. Descrições revisadas [2:00–2:30]

- Volte ao painel, aba **Descrições**, clique em **Sugerir 3 descrições**.
- "A IA só usa os dados do produto. Se inventar um número ou uma promessa, como garantia ou frete grátis, o painel avisa. Nada vai para o site sem a loja aprovar."
- Aprove uma.

## 6. Agentes de IA [2:30–2:50]

- Aba **Conectar agentes**, clique em **Gerar token**.
- "Cada loja tem um servidor MCP próprio: o Claude ou qualquer agente pode consultar o catálogo, só leitura, com um token só desta loja."

## 7. Fechamento [2:50–3:00]

"Por baixo: busca vetorial no Postgres, isolamento entre lojas testado, e cada mudança só vai ao ar se passar numa avaliação automática com ataques de injeção de prompt. O código está no GitHub."

Tela: o README com o diagrama.
